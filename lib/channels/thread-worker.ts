// ─── Thread worker: processes one ChannelThread tick ─────────────────────────
//
// Called by the outreach-tick cron for every ChannelThread whose nextActionAt
// has passed. Each call advances the thread by exactly one step:
//   PENDING  → send initial message (invite / InMail / email / WhatsApp)
//   ACTIVE   → send next followup (or archive if all exhausted)
//   Any      → archive if provider timeout detected
//
// On success the worker sets the next nextActionAt.
// On failure the cron resets nextActionAt to now+5min for automatic retry.
//
// All API calls are OUTSIDE database transactions — we only hold row locks
// during the brief UPDATE that claims the thread in the cron query.

import { prisma } from "@/lib/prisma";
import { ChannelType, OutreachType } from "@prisma/client";
import {
  sendInvitation,
  sendInMail,
  startChat,
  sendChatMessage,
  sendEmail,
  sendWhatsApp,
  listSentInvitations,
  cancelInvitation,
} from "@/lib/services/unipile.service";
import { buildVars, renderTemplate } from "@/lib/outreach/render-template";
import { recomputeTaskStage } from "./stage-rollup";
import {
  matchRule,
  quietHoursEnd,
  type LinkedInConfig,
  type EmailConfig,
  type WAConfig,
  type LinkedInInviteRule,
  type QuietHours,
} from "./types";

// ─── Public entry point ───────────────────────────────────────────────────────

export async function processThread(threadId: string): Promise<void> {
  const thread = await prisma.channelThread.findUnique({
    where: { id: threadId },
    include: {
      channel: {
        include: { sendingAccount: true },
      },
      task: {
        select: {
          id: true,
          result: true,
          analysisResult: true,
          contact: { select: { email: true, workEmail: true, personalEmail: true, phone: true } },
        },
      },
    },
  });

  if (!thread) {
    console.warn(`[ThreadWorker] Thread ${threadId} not found — skipping`);
    return;
  }

  // Terminal states — nothing to do
  if (thread.status === "ARCHIVED" || thread.status === "REPLIED" || thread.status === "PAUSED") return;

  const account = thread.channel.sendingAccount;
  if (!account) {
    console.warn(`[ThreadWorker] Thread ${threadId}: no sending account on channel ${thread.channelId} — archiving`);
    await archiveThread(thread.id, "No sending account configured");
    return;
  }

  // Build template vars from stored profile + analysis
  const profile = thread.task.result ? JSON.parse(thread.task.result as string) : {};
  const analysis = thread.task.analysisResult ? JSON.parse(thread.task.analysisResult as string) : {};
  const vars = buildVars(profile, analysis);
  const contact = thread.task.contact ?? null;

  const config = thread.channel.config as Record<string, unknown>;
  const tag = `[ThreadWorker ${thread.channelType} ${threadId.slice(-6)}]`;

  try {
    switch (thread.channelType) {
      case ChannelType.LINKEDIN:
        await processLinkedIn(thread as FullThread, config as unknown as LinkedInConfig, vars, account, profile, tag);
        break;
      case ChannelType.EMAIL:
        await processEmail(thread as FullThread, config as unknown as EmailConfig, vars, account, contact, tag);
        break;
      case ChannelType.WHATSAPP:
        await processWhatsApp(thread as FullThread, config as unknown as WAConfig, vars, account, contact, tag);
        break;
    }

    // Recompute task stage after every thread state change
    await recomputeTaskStage(thread.taskId);
  } catch (err: any) {
    console.error(`${tag} Error: ${err.message}`);
    throw err; // let the cron handle retry scheduling
  }
}

// ─── LinkedIn ─────────────────────────────────────────────────────────────────

async function processLinkedIn(
  thread: FullThread,
  config: LinkedInConfig,
  vars: ReturnType<typeof buildVars>,
  account: AccountRow,
  profile: Record<string, unknown>,
  tag: string,
): Promise<void> {
  const providerState = (thread.providerState as ProviderState | null) ?? {};
  const providerUserId = String(profile.provider_id || profile.public_identifier || "");

  if (!providerUserId) {
    await archiveThread(thread.id, "No LinkedIn provider ID on task profile");
    return;
  }

  // ── Enforce daily cap ──
  const capReached = await isDailyCapReached(thread.channelId, thread.channel.dailyCap);
  if (capReached) {
    // Push to tomorrow 00:01 so it's picked up after reset
    const tomorrow = startOfNextDay();
    await prisma.channelThread.update({
      where: { id: thread.id },
      data: { nextActionAt: tomorrow },
    });
    console.log(`${tag} Daily cap reached — rescheduled to ${tomorrow.toISOString()}`);
    return;
  }

  // ── Phase: PENDING — send initial message ──────────────────────────────────
  if (thread.status === "PENDING") {
    const rule = matchRule<LinkedInInviteRule>(
      parseFloat(String(vars.score)) || 0,
      config.inviteRules ?? [],
    ) ?? config.inviteRules.find(r => r.key === thread.matchedRuleKey);

    if (!rule) {
      await archiveThread(thread.id, `Matched rule key "${thread.matchedRuleKey}" not found in config`);
      return;
    }

    if (rule.inviteType === "CONNECTION_REQUEST") {
      await sendLinkedInInvite(thread, rule, vars, account, config, providerUserId, tag);
    } else {
      await sendLinkedInInMail(thread, rule, vars, account, config, providerUserId, tag);
    }
    return;
  }

  // ── Phase: ACTIVE + INVITE_PENDING — check for timeout ────────────────────
  if (providerState.phase === "INVITE_PENDING") {
    // nextActionAt was set to inviteSentAt + archiveAfterInviteDays by the invite send.
    // Reaching here means it has expired without webhook firing — cancel and archive.
    await cancelPendingInvite(account, providerUserId, tag);
    console.log(`${tag} Invite timed out — archiving`);
    await archiveThread(thread.id, "Invite acceptance timeout");
    return;
  }

  // ── Phase: ACTIVE + CONNECTED — send first DM ────────────────────────────
  if (providerState.phase === "CONNECTED" && !thread.lastMessageAt) {
    const firstDmTemplate = config.followups?.[0];
    if (!firstDmTemplate) {
      // No DM configured — thread is done (connected but no messages to send)
      await prisma.channelThread.update({
        where: { id: thread.id },
        data: { nextActionAt: null },
      });
      return;
    }

    const text = renderTemplate(firstDmTemplate.template, vars);
    const { chatId, messageId } = await startChat({
      accountId: account.accountId,
      providerUserId,
      text,
      accountDsn: account.dsn ?? undefined,
      accountApiKey: account.apiKey ?? undefined,
    });

    const nextFollowup = config.followups?.[1];
    const nextAt = nextFollowup ? daysFromNow(nextFollowup.afterDays) : null;

    await prisma.$transaction([
      prisma.channelThread.update({
        where: { id: thread.id },
        data: {
          providerChatId: chatId,
          lastMessageAt: new Date(),
          followupsSent: 1,
          nextActionAt: nextAt,
        },
      }),
      prisma.threadMessage.create({
        data: {
          threadId: thread.id,
          type: OutreachType.FIRST_DM,
          renderedBody: text,
          sentAt: new Date(),
          providerChatId: chatId,
          providerMessageId: messageId || null,
        },
      }),
    ]);
    console.log(`${tag} First DM sent — chatId=${chatId}`);
    return;
  }

  // ── Phase: ACTIVE — send follow-up ────────────────────────────────────────
  if (thread.status === "ACTIVE" && thread.followupsSent < thread.followupsTotal) {
    const followup = config.followups?.[thread.followupsSent];
    if (!followup || !thread.providerChatId) {
      await archiveThread(thread.id, "Missing followup config or chat ID");
      return;
    }

    const text = renderTemplate(followup.template, vars);
    const { messageId } = await sendChatMessage({
      accountId: account.accountId,
      chatId: thread.providerChatId,
      text,
      accountDsn: account.dsn ?? undefined,
      accountApiKey: account.apiKey ?? undefined,
    });

    const nextFollowup = config.followups?.[thread.followupsSent + 1];
    const nextAt = nextFollowup ? daysFromNow(nextFollowup.afterDays) : null;
    const newSent = thread.followupsSent + 1;

    await prisma.$transaction([
      prisma.channelThread.update({
        where: { id: thread.id },
        data: {
          lastMessageAt: new Date(),
          followupsSent: newSent,
          nextActionAt: nextAt,
        },
      }),
      prisma.threadMessage.create({
        data: {
          threadId: thread.id,
          type: OutreachType.FOLLOWUP,
          renderedBody: text,
          sentAt: new Date(),
          providerChatId: thread.providerChatId,
          providerMessageId: messageId || null,
        },
      }),
    ]);
    console.log(`${tag} Follow-up ${newSent}/${thread.followupsTotal} sent`);

    if (!nextAt) {
      await archiveThread(thread.id, "All follow-ups exhausted — no reply received");
    }
    return;
  }

  // All followups sent — archive
  if (thread.followupsSent >= thread.followupsTotal) {
    await archiveThread(thread.id, "All follow-ups exhausted — no reply received");
  }
}

async function sendLinkedInInvite(
  thread: FullThread,
  rule: LinkedInInviteRule,
  vars: ReturnType<typeof buildVars>,
  account: AccountRow,
  config: LinkedInConfig,
  providerUserId: string,
  tag: string,
): Promise<void> {
  const note = rule.noteTemplate
    ? renderTemplate(rule.noteTemplate, vars).slice(0, 300)
    : undefined;

  const { invitationId } = await sendInvitation({
    accountId: account.accountId,
    providerUserId,
    message: note,
    accountDsn: account.dsn ?? undefined,
    accountApiKey: account.apiKey ?? undefined,
  });

  // nextActionAt = invite sent + archiveAfterInviteDays (invite timeout deadline)
  const timeoutAt = daysFromNow(config.archiveAfterInviteDays ?? 14);

  await prisma.$transaction([
    prisma.channelThread.update({
      where: { id: thread.id },
      data: {
        status: "ACTIVE",
        providerState: { phase: "INVITE_PENDING", inviteSentAt: new Date().toISOString() },
        inviteSentAt: new Date(),
        nextActionAt: timeoutAt,
      },
    }),
    prisma.threadMessage.create({
      data: {
        threadId: thread.id,
        type: OutreachType.INVITE,
        renderedBody: note ?? "",
        sentAt: new Date(),
        providerMessageId: invitationId || null,
      },
    }),
  ]);
  console.log(`${tag} Invite sent — invitationId=${invitationId}`);
}

async function sendLinkedInInMail(
  thread: FullThread,
  rule: LinkedInInviteRule,
  vars: ReturnType<typeof buildVars>,
  account: AccountRow,
  config: LinkedInConfig,
  providerUserId: string,
  tag: string,
): Promise<void> {
  // Enforce separate InMail daily cap
  const inmailCapReached = await isDailyInMailCapReached(thread.channelId, thread.channel.dailyInMailCap);
  if (inmailCapReached) {
    const tomorrow = startOfNextDay();
    await prisma.channelThread.update({
      where: { id: thread.id },
      data: { nextActionAt: tomorrow },
    });
    console.log(`${tag} InMail daily cap reached — rescheduled to ${tomorrow.toISOString()}`);
    return;
  }

  const message = rule.messageTemplate ? renderTemplate(rule.messageTemplate, vars) : "";
  const { chatId, messageId } = await sendInMail({
    accountId: account.accountId,
    providerUserId,
    text: message,
    accountDsn: account.dsn ?? undefined,
    accountApiKey: account.apiKey ?? undefined,
  });

  const nextFollowup = config.followups?.[0];
  const nextAt = nextFollowup ? daysFromNow(nextFollowup.afterDays) : null;

  await prisma.$transaction([
    prisma.channelThread.update({
      where: { id: thread.id },
      data: {
        status: "ACTIVE",
        providerState: { phase: "INMAIL_SENT" },
        providerChatId: chatId,
        lastMessageAt: new Date(),
        nextActionAt: nextAt,
      },
    }),
    prisma.threadMessage.create({
      data: {
        threadId: thread.id,
        type: OutreachType.INMAIL,
        renderedBody: message,
        sentAt: new Date(),
        providerChatId: chatId,
        providerMessageId: messageId || null,
      },
    }),
  ]);
  console.log(`${tag} InMail sent — chatId=${chatId}`);
}

// ─── Email ────────────────────────────────────────────────────────────────────

async function processEmail(
  thread: FullThread,
  config: EmailConfig,
  vars: ReturnType<typeof buildVars>,
  account: AccountRow,
  contact: ContactRow | null,
  tag: string,
): Promise<void> {
  const recipientEmail = contact?.workEmail || contact?.email || contact?.personalEmail || null;
  if (!recipientEmail) {
    await archiveThread(thread.id, "No email address found for candidate — check CandidateContact");
    return;
  }

  // Enforce daily cap
  const capReached = await isDailyCapReached(thread.channelId, thread.channel.dailyCap);
  if (capReached) {
    await prisma.channelThread.update({ where: { id: thread.id }, data: { nextActionAt: startOfNextDay() } });
    return;
  }

  if (thread.status === "PENDING") {
    const rule = matchRule(0, config.emailRules ?? []) ??
      config.emailRules.find(r => r.key === thread.matchedRuleKey);
    if (!rule) {
      await archiveThread(thread.id, "Email rule not found");
      return;
    }

    const subject = renderTemplate(rule.subjectTemplate, vars);
    const body = renderTemplate(rule.bodyTemplate, vars);

    const result = await sendEmail({
      account,
      to: recipientEmail,
      toName: String(vars.name || ""),
      subject,
      body,
      tag,
    });
    if (!result.ok) {
      await archiveThread(thread.id, `Email send failed: ${result.error}`);
      return;
    }

    const nextFollowup = config.followups?.[0];
    const nextAt = nextFollowup ? daysFromNow(nextFollowup.afterDays) : null;

    await prisma.$transaction([
      prisma.channelThread.update({
        where: { id: thread.id },
        data: {
          status: "ACTIVE",
          providerState: { phase: "SENT" },
          // Store the sent email's provider_id so follow-ups can thread via reply_to
          providerThreadId: result.replyToId ?? null,
          lastMessageAt: new Date(),
          nextActionAt: nextAt,
        },
      }),
      prisma.threadMessage.create({
        data: {
          threadId: thread.id,
          type: OutreachType.EMAIL,
          renderedSubject: subject,
          renderedBody: body,
          sentAt: new Date(),
          providerMessageId: result.messageId ?? null,
        },
      }),
    ]);
    console.log(`${tag} Email sent to ${recipientEmail}`);
    return;
  }

  // Follow-up emails
  if (thread.status === "ACTIVE" && thread.followupsSent < thread.followupsTotal) {
    const followup = config.followups?.[thread.followupsSent];
    if (!followup) {
      await archiveThread(thread.id, "Missing followup config");
      return;
    }
    const subject = renderTemplate(followup.subjectTemplate ?? "", vars);
    const body = renderTemplate(followup.template, vars);

    const result = await sendEmail({
      account,
      to: recipientEmail,
      toName: String(vars.name || ""),
      subject,
      body,
      tag,
      replyToId: thread.providerThreadId ?? undefined,
    });
    if (!result.ok) {
      await archiveThread(thread.id, `Email followup failed: ${result.error}`);
      return;
    }

    const nextFollowup = config.followups?.[thread.followupsSent + 1];
    const nextAt = nextFollowup ? daysFromNow(nextFollowup.afterDays) : null;
    const newSent = thread.followupsSent + 1;

    await prisma.$transaction([
      prisma.channelThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: new Date(), followupsSent: newSent, nextActionAt: nextAt },
      }),
      prisma.threadMessage.create({
        data: {
          threadId: thread.id,
          type: OutreachType.FOLLOWUP,
          renderedSubject: subject,
          renderedBody: body,
          sentAt: new Date(),
          providerMessageId: result.messageId ?? null,
        },
      }),
    ]);
    console.log(`${tag} Email follow-up ${newSent}/${thread.followupsTotal} sent`);

    if (!nextAt) {
      await archiveThread(thread.id, "All email follow-ups exhausted");
    }
  }
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

async function processWhatsApp(
  thread: FullThread,
  config: WAConfig,
  vars: ReturnType<typeof buildVars>,
  account: AccountRow,
  contact: ContactRow | null,
  tag: string,
): Promise<void> {
  // Phone number in E.164 format from CandidateContact
  const phone = contact?.phone ?? null;
  if (!phone) {
    await archiveThread(thread.id, "No phone number found for candidate — check CandidateContact");
    return;
  }

  // Enforce quiet hours before anything else
  if (config.quietHours) {
    const endsAt = quietHoursEnd(config.quietHours as QuietHours);
    if (endsAt) {
      await prisma.channelThread.update({ where: { id: thread.id }, data: { nextActionAt: endsAt } });
      console.log(`${tag} In quiet hours — rescheduled to ${endsAt.toISOString()}`);
      return;
    }
  }

  // Enforce daily cap
  const capReached = await isDailyCapReached(thread.channelId, thread.channel.dailyCap);
  if (capReached) {
    await prisma.channelThread.update({ where: { id: thread.id }, data: { nextActionAt: startOfNextDay() } });
    return;
  }

  if (thread.status === "PENDING") {
    const rule = matchRule(0, config.waRules ?? []) ??
      config.waRules.find(r => r.key === thread.matchedRuleKey);
    if (!rule) {
      await archiveThread(thread.id, "WhatsApp rule not found");
      return;
    }

    const message = renderTemplate(rule.messageTemplate, vars);
    const result = await sendWhatsApp({ account, message, phone, tag });
    if (!result.ok) {
      await archiveThread(thread.id, `WhatsApp send failed: ${result.error}`);
      return;
    }

    const nextFollowup = config.followups?.[0];
    const nextAt = nextFollowup ? daysFromNow(nextFollowup.afterDays) : null;

    await prisma.$transaction([
      prisma.channelThread.update({
        where: { id: thread.id },
        data: {
          status: "ACTIVE",
          providerState: { phase: "DELIVERED" },
          providerChatId: result.chatId ?? null,
          lastMessageAt: new Date(),
          nextActionAt: nextAt,
        },
      }),
      prisma.threadMessage.create({
        data: {
          threadId: thread.id,
          type: OutreachType.WHATSAPP,
          renderedBody: message,
          sentAt: new Date(),
          providerChatId: result.chatId ?? null,
          providerMessageId: result.messageId ?? null,
        },
      }),
    ]);
    console.log(`${tag} WhatsApp sent to ${phone}`);
    return;
  }

  // Follow-ups
  if (thread.status === "ACTIVE" && thread.followupsSent < thread.followupsTotal) {
    const followup = config.followups?.[thread.followupsSent];
    if (!followup || !thread.providerChatId) {
      await archiveThread(thread.id, "Missing followup config or chat ID");
      return;
    }
    const message = renderTemplate(followup.template, vars);
    const result = await sendWhatsApp({ account, message, phone, chatId: thread.providerChatId, tag });
    if (!result.ok) {
      await archiveThread(thread.id, `WhatsApp followup failed: ${result.error}`);
      return;
    }

    const nextFollowup = config.followups?.[thread.followupsSent + 1];
    const nextAt = nextFollowup ? daysFromNow(nextFollowup.afterDays) : null;
    const newSent = thread.followupsSent + 1;

    await prisma.$transaction([
      prisma.channelThread.update({
        where: { id: thread.id },
        data: { lastMessageAt: new Date(), followupsSent: newSent, nextActionAt: nextAt },
      }),
      prisma.threadMessage.create({
        data: {
          threadId: thread.id,
          type: OutreachType.WHATSAPP,
          renderedBody: message,
          sentAt: new Date(),
          providerChatId: thread.providerChatId,
          providerMessageId: result.messageId ?? null,
        },
      }),
    ]);
    console.log(`${tag} WhatsApp follow-up ${newSent}/${thread.followupsTotal} sent`);

    if (!nextAt) {
      await archiveThread(thread.id, "All WhatsApp follow-ups exhausted");
    }
  }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

// Finds the pending invite for a candidate and cancels it via Unipile.
// Used before archiving a timed-out INVITE_PENDING thread. Non-throwing.
async function cancelPendingInvite(
  account: AccountRow,
  providerUserId: string,
  tag: string,
): Promise<void> {
  try {
    const sent = await listSentInvitations({
      accountId: account.accountId,
      accountDsn: account.dsn ?? undefined,
      accountApiKey: account.apiKey ?? undefined,
    });
    const match = sent.find(
      inv => inv.invitedUserId === providerUserId || inv.invitedUserPublicId === providerUserId,
    );
    if (!match) return; // already accepted or withdrawn
    const ok = await cancelInvitation({
      invitationId: match.id,
      accountId: account.accountId,
      accountDsn: account.dsn ?? undefined,
      accountApiKey: account.apiKey ?? undefined,
    });
    if (ok) console.log(`${tag} Cancelled pending invite ${match.id}`);
  } catch (err: any) {
    console.warn(`${tag} Failed to cancel invite: ${err.message}`);
  }
}

export async function archiveThread(threadId: string, reason: string): Promise<void> {
  await prisma.channelThread.update({
    where: { id: threadId },
    data: {
      status: "ARCHIVED",
      archivedAt: new Date(),
      archivedReason: reason,
      nextActionAt: null,
    },
  });
}

// Mark a thread REPLIED and pause all sibling threads on the same task
export async function markThreadReplied(threadId: string, taskId: string): Promise<void> {
  await prisma.$transaction([
    prisma.channelThread.update({
      where: { id: threadId },
      data: { status: "REPLIED", nextActionAt: null },
    }),
    // Pause every other active thread on the same task
    prisma.channelThread.updateMany({
      where: {
        taskId,
        id: { not: threadId },
        status: { in: ["PENDING", "ACTIVE"] },
      },
      data: { status: "PAUSED", nextActionAt: null },
    }),
  ]);
}

// Resume paused sibling threads (e.g. recruiter dismissed an off-topic reply)
export async function resumeSiblingThreads(taskId: string, skipThreadId: string): Promise<void> {
  await prisma.channelThread.updateMany({
    where: {
      taskId,
      id: { not: skipThreadId },
      status: "PAUSED",
    },
    data: {
      status: "ACTIVE",
      // Give the recruiter 24h before next followup fires
      nextActionAt: daysFromNow(1),
    },
  });
}

// ─── Daily cap helpers ────────────────────────────────────────────────────────

async function isDailyCapReached(channelId: string, cap: number): Promise<boolean> {
  const todayStart = startOfToday();
  const count = await prisma.threadMessage.count({
    where: {
      thread: { channelId },
      type: { in: [OutreachType.INVITE, OutreachType.INMAIL, OutreachType.FIRST_DM, OutreachType.EMAIL, OutreachType.WHATSAPP] },
      sentAt: { gte: todayStart },
      status: "SENT",
    },
  });
  return count >= cap;
}

async function isDailyInMailCapReached(channelId: string, cap: number): Promise<boolean> {
  const todayStart = startOfToday();
  const count = await prisma.threadMessage.count({
    where: {
      thread: { channelId },
      type: OutreachType.INMAIL,
      sentAt: { gte: todayStart },
      status: "SENT",
    },
  });
  return count >= cap;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfNextDay(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

// ─── Internal types ───────────────────────────────────────────────────────────

type ProviderState = Record<string, string>;

type AccountRow = {
  id: string;
  accountId: string;
  dsn: string | null;
  apiKey: string | null;
};

type ContactRow = {
  email: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
};

type FullThread = {
  id: string;
  taskId: string;
  channelId: string;
  channelType: ChannelType;
  status: string;
  providerState: unknown;
  matchedRuleKey: string | null;
  nextActionAt: Date | null;
  inviteSentAt: Date | null;
  lastMessageAt: Date | null;
  followupsSent: number;
  followupsTotal: number;
  providerChatId: string | null;
  providerThreadId: string | null;
  channel: {
    id: string;
    dailyCap: number;
    dailyInMailCap: number;
    sendingAccount: AccountRow | null;
  };
  task: {
    id: string;
    result: string | null;
    analysisResult: string | null;
    contact: ContactRow | null;
  };
};
