/**
 * Trigger the process-tasks endpoint.
 * Used by after() callbacks and the safety-net cron.
 */
export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

export async function triggerProcessing(): Promise<void> {
  const base = getBaseUrl();
  const url = `${base}/api/process-tasks`;
  console.log(`[Trigger] Calling ${url} (CRON_SECRET set: ${!!process.env.CRON_SECRET})`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });
    const body = await res.text();
    console.log(`[Trigger] Response: ${res.status} - ${body}`);
  } catch (err) {
    console.error("[Trigger] Failed to trigger processing:", err);
  }
}

export async function triggerOutreach(): Promise<void> {
  const base = getBaseUrl();
  const url = `${base}/api/cron/outreach-tick`;
  console.log(`[Trigger] Calling ${url} (CRON_SECRET set: ${!!process.env.CRON_SECRET})`);
  try {
    fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    }).catch((err) => console.error("[Trigger] Outreach fetch failed:", err));
  } catch (err) {
    console.error("[Trigger] Failed to trigger outreach:", err);
  }
}
