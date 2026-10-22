// Sets up what a fresh database needs to run: the organisation Settings, the receipt counter and the
// home-screen quick link tiles.
// Usage: npm run seed. Existing data is never changed, so it is safe to re-run.
// Villages come from `npm run import-places -- --apply`, admins from `npm run create-admin`.
import { connectDb, disconnectDb } from '../config/db.js';
import { Counter, QuickLink, Settings } from '../models/index.js';
import * as data from './data.js';

async function main() {
  await connectDb();

  const { _id, ...settings } = data.settings;
  const s = await Settings.updateOne({ _id }, { $setOnInsert: settings }, { upsert: true });
  console.log(`[seed] Settings: ${s.upsertedCount ? 'created' : 'already set, left as is'}`);

  const c = await Counter.updateOne({ _id: 'receipt' }, { $setOnInsert: { seq: 0 } }, { upsert: true });
  console.log(`[seed] Receipt counter: ${c.upsertedCount ? 'created' : 'already set, left as is'}`);

  if (await QuickLink.exists({})) console.log('[seed] Quick links: already set, left as is');
  else {
    await QuickLink.insertMany(data.quickLinks.map((q, order) => ({ ...q, order })));
    console.log(`[seed] Quick links: created ${data.quickLinks.length}`);
  }
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
