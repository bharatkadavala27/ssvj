// Creates (or promotes) an admin account. Usage: npm run create-admin -- <mobile> "<name>"
// After this, that number can log in to the admin dashboard with an OTP.
import { connectDb, disconnectDb } from '../config/db.js';
import { User } from '../models/index.js';
import { normalizePhone } from '../lib/auth.js';

const [rawPhone, ...nameParts] = process.argv.slice(2);
const phone = normalizePhone(rawPhone);
const name = nameParts.join(' ').trim();

if (!phone || !name) {
  console.error('Usage: npm run create-admin -- <10-digit mobile> "<name>"');
  process.exit(1);
}

try {
  await connectDb();
  const user = await User.findOneAndUpdate(
    { phone },
    { $set: { role: 'admin', active: true, name } },
    { new: true, upsert: true },
  );
  console.log(`[admin] ${user.name} (${user.phone}) is now an admin`);
} catch (err) {
  console.error('[admin] failed:', err.message);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
