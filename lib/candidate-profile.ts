// ─── CandidateProfile identity helpers ────────────────────────────────────────
//
// CandidateProfile is the canonical identity row for a candidate, joined to
// Task via Task.candidateProfileId. Multiple Tasks across different
// requisitions share the same CandidateProfile when their linkedinUrl maps
// to the same canonical form — see lib/canonicalize-url.ts.
//
// Pre-existing data has multiple CandidateProfile rows per canonical URL
// (the persist-linkedin-result pipeline used to create one per analysis).
// A follow-up dedup migration will collapse those, but in the meantime
// getOrCreateCandidateProfile picks the most recent matching row for
// existing duplicates and avoids creating new ones.

import { prisma } from "@/lib/prisma";
import { canonicalizeLinkedinUrl } from "@/lib/canonicalize-url";

export interface ProfileSeed {
  linkedinUrl: string;
  name?: string;
  headline?: string;
  location?: string;
  rawProfile?: string | null;
}

/**
 * Find or create a CandidateProfile by canonical LinkedIn URL.
 *
 * Returns null when the URL doesn't canonicalize to a valid LinkedIn profile
 * URL — caller can choose to skip identity linkage in that case.
 */
export async function getOrCreateCandidateProfile(
  seed: ProfileSeed,
): Promise<{ id: string; canonicalLinkedinUrl: string } | null> {
  const canonical = canonicalizeLinkedinUrl(seed.linkedinUrl);
  if (!canonical) return null;

  // Pre-existing duplicates: pick the most recently scraped row.
  const existing = await prisma.candidateProfile.findFirst({
    where: { canonicalLinkedinUrl: canonical },
    orderBy: { scrapedAt: "desc" },
    select: { id: true, canonicalLinkedinUrl: true },
  });
  if (existing && existing.canonicalLinkedinUrl) {
    return { id: existing.id, canonicalLinkedinUrl: existing.canonicalLinkedinUrl };
  }

  // No row yet (or row exists but canonicalLinkedinUrl wasn't backfilled —
  // treat as "not found" for our purposes; create a new one with canonical
  // populated, and let the dedup migration handle the legacy null rows).
  const created = await prisma.candidateProfile.create({
    data: {
      linkedinUrl: seed.linkedinUrl,
      canonicalLinkedinUrl: canonical,
      name: seed.name ?? "",
      headline: seed.headline ?? "",
      location: seed.location ?? "",
      rawProfile: seed.rawProfile ?? null,
    },
    select: { id: true, canonicalLinkedinUrl: true },
  });
  return {
    id: created.id,
    canonicalLinkedinUrl: created.canonicalLinkedinUrl ?? canonical,
  };
}
