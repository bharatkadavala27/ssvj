/**
 * Render's free plan puts a service to sleep after 15 minutes without incoming requests, and the
 * next request then waits ~50 s for it to start. While running on Render, the server calls its own
 * public /api/health every 10 minutes; that goes through Render's proxy, counts as incoming traffic and
 * keeps the service awake. A sleeping service cannot wake itself, so an outside monitor (UptimeRobot,
 * every 5 minutes) is still the backstop.
 *
 * Render sets RENDER_EXTERNAL_URL. KEEP_ALIVE_URL overrides it; KEEP_ALIVE=off disables the pings.
 */
export function startKeepAlive() {
  const base = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  if (!base || process.env.KEEP_ALIVE === 'off') return;
  const url = `${base.replace(/\/+$/, '')}/api/health`;
  const minutes = Math.max(1, Number(process.env.KEEP_ALIVE_MINUTES) || 10);

  const ping = async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) console.warn(`[keep-alive] ${url} answered ${res.status}`);
    } catch (err) {
      console.warn(`[keep-alive] ping failed: ${err.message}`);
    }
  };
  setInterval(ping, minutes * 60 * 1000).unref();
  console.log(`[keep-alive] pinging ${url} every ${minutes} min`);
}
