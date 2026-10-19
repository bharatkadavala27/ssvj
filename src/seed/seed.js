// Resets content collections to the sample data. Usage: npm run seed [-- --force]
// User accounts and the receipt counter are never touched.
import { connectDb, disconnectDb } from '../config/db.js';
import { Banner, Campaign, Counter, Donation, Event, Gallery, Notification, Settings, Sponsor, Village } from '../models/index.js';
import * as data from './data.js';

const force = process.argv.includes('--force');

async function main() {
  await connectDb();

  const realDonations = await Donation.countDocuments({ source: { $ne: 'seed' } });
  if (realDonations && !force) {
    console.error(`[seed] refusing: ${realDonations} real donation(s) exist. Re-run with --force to wipe them.`);
    process.exitCode = 1;
    return;
  }

  const sets = [
    [Village, data.villages],
    [Campaign, data.campaigns],
    [Donation, data.donations],
    [Banner, data.banners],
    [Sponsor, data.sponsors],
    [Event, data.events],
    [Notification, data.notifications],
    [Gallery, data.gallery],
  ];
  for (const [Model, rows] of sets) {
    await Model.deleteMany({});
    // timestamps:false keeps the seeded createdAt values
    await Model.insertMany(rows, { timestamps: false });
    await Model.syncIndexes();
    console.log(`[seed] ${Model.modelName}: ${rows.length}`);
  }

  await Settings.findByIdAndUpdate('org', data.settings, { upsert: true, overwrite: true });
  await Counter.updateOne({ _id: 'receipt' }, { $setOnInsert: { seq: 0 } }, { upsert: true });
  console.log('[seed] Settings: 1');
  console.log('[seed] Villages were reset: run `npm run import-places -- --apply` to restore the imported district/taluka/village lists.');
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
