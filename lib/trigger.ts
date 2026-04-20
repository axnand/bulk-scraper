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
  const hasSecret = !!process.env.CRON_SECRET;
  const hasAppUrl = !!process.env.NEXT_PUBLIC_APP_URL;
  const hasVercelUrl = !!process.env.VERCEL_URL;
  console.log(`[Trigger] 🚀 Calling ${url}`);
  console.log(`[Trigger]    CRON_SECRET=${hasSecret} NEXT_PUBLIC_APP_URL=${hasAppUrl} VERCEL_URL=${hasVercelUrl} baseUrl="${base}"`);
  const triggerStart = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
    });
    const body = await res.text();
    console.log(`[Trigger] ${res.ok ? "✅" : "❌"} Response: ${res.status} in ${Date.now() - triggerStart}ms — ${body}`);
    if (!res.ok) {
      console.error(`[Trigger] ❌ Non-OK response ${res.status} — processing may not have started!`);
    }
  } catch (err: any) {
    console.error(`[Trigger] 💥 FAILED to reach ${url} after ${Date.now() - triggerStart}ms — ${err.message}`);
    console.error(`[Trigger]    This means process-tasks was never called. Check baseUrl config above.`);
  }
}
