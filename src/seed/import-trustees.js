// Adds the trustee board from src/seed/trustees.json (designations and trustees).
// Usage: npm run import-trustees            (dry run: prints what would be added)
//        npm run import-trustees -- --apply (writes; only adds what is missing, never changes or deletes)
import { readFileSync } from 'node:fs';
import { connectDb, disconnectDb } from '../config/db.js';
import { Trustee, TrusteeRole } from '../models/index.js';

const apply = process.argv.includes('--apply');
const data = JSON.parse(readFileSync(new URL('./trustees.json', import.meta.url), 'utf8'));

try {
  await connectDb();
  const roles = new Set((await TrusteeRole.find().lean()).map((r) => r.key));
  const newRoles = data.roles
    .map((r, i) => ({ key: r.key, name: { gu: r.gu, en: r.en }, order: i }))
    .filter((r) => !roles.has(r.key));

  const existing = new Set((await Trustee.find().lean()).map((t) => t.name.gu.trim()));
  const perRole = {};
  const newTrustees = data.trustees
    .map((t) => ({ role: t.role, name: { gu: t.gu, en: t.en }, phone: t.phone || null, order: (perRole[t.role] = (perRole[t.role] ?? -1) + 1) }))
    .filter((t) => !existing.has(t.name.gu));

  console.log(`Designations to add: ${newRoles.length} (${newRoles.map((r) => r.name.gu).join(', ') || '—'})`);
  console.log(`Trustees to add: ${newTrustees.length} of ${data.trustees.length}`);
  if (apply) {
    if (newRoles.length) await TrusteeRole.insertMany(newRoles);
    if (newTrustees.length) await Trustee.insertMany(newTrustees);
    console.log('Done.');
  } else {
    console.log('Dry run. Add --apply to write.');
  }
} finally {
  await disconnectDb();
}
