import { env } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';
import { startKeepAlive } from './lib/keepAlive.js';

async function main() {
  await connectDb();
  const server = createApp().listen(env.port, () => {
    console.log(`[api] listening on http://localhost:${env.port}/api`);
    startKeepAlive(); // only on Render (or when KEEP_ALIVE_URL is set)
  });

  const shutdown = (signal) => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(() => disconnectDb().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[api] failed to start:', err.message);
  process.exit(1);
});
