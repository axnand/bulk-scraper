// ─── LinkedIn URL canonicalization ────────────────────────────────────────────
//
// LinkedIn URLs come in many forms for the same person:
//
//   https://linkedin.com/in/john-smith
//   https://www.linkedin.com/in/john-smith/
//   https://www.linkedin.com/in/John-Smith
//   http://www.linkedin.com/in/john-smith?utm_source=…
//   linkedin.com/in/john-smith
//
// All of those refer to the same person. To support cross-task identity
// (Phase 6 — Candidate identity table), we need a single canonical key.
//
// Canonical form: `linkedin.com/in/<slug>` (no protocol, no www, no trailing
// slash, no query / fragment, lowercase). Unrecognized URLs return null —
// caller handles the absence (e.g., a recruiter pasted a non-LinkedIn URL
// they want stored verbatim but not joined to identity).

const LINKEDIN_HOSTS = new Set([
  "linkedin.com",
  "www.linkedin.com",
  "in.linkedin.com",
  "uk.linkedin.com",
  "fr.linkedin.com",
  "de.linkedin.com",
]);

const PROFILE_PATH_PREFIX = "/in/";

export function canonicalizeLinkedinUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Add a scheme if missing so URL() can parse `linkedin.com/in/foo`.
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!LINKEDIN_HOSTS.has(host)) return null;

  // Path canonicalization: keep only `/in/<slug>`, drop trailing slash.
  let path = url.pathname.toLowerCase();
  if (!path.startsWith(PROFILE_PATH_PREFIX)) return null;

  // Strip trailing slash(es)
  path = path.replace(/\/+$/, "");

  // Path must be of form /in/<slug> with at least 1 char of slug
  const slug = path.slice(PROFILE_PATH_PREFIX.length);
  if (!slug) return null;
  // Reject paths that have additional segments (e.g., /in/foo/details/contact-info).
  // We canonicalize to the profile root; sub-pages all resolve to the same person.
  const slugRoot = slug.split("/")[0];
  if (!slugRoot) return null;

  return `linkedin.com/in/${slugRoot}`;
}
