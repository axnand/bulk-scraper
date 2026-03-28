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
  try {
    await fetch(`${base}/api/process-tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.error("[Trigger] Failed to trigger processing:", err);
  }
}
