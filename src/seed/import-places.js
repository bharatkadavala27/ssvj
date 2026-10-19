// Imports Gujarat districts + talukas, and village lists per taluka, from JSON files in src/seed/places/.
// Usage: npm run import-places            (dry run: prints what would change)
//        npm run import-places -- --apply (writes; upserts by key, never deletes)
//
// places/gujarat-talukas.json: { districts: [{ gu, en, talukas: [{ gu, en, status? }] }] }
// places/villages-<district>.json: { district: { gu, en }, talukas: [{ gu, en, villages: [{ gu, en }] }] }
import { readFileSync, readdirSync } from 'node:fs';
import { connectDb, disconnectDb } from '../config/db.js';
import { District, Taluka, Village } from '../models/index.js';

const DIR = new URL('./places/', import.meta.url);
const apply = process.argv.includes('--apply');
const read = (name) => JSON.parse(readFileSync(new URL(name, DIR), 'utf8'));
const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const loc = (o) => ({ gu: String(o.gu).trim(), en: String(o.en || o.gu).trim() });
const same = (a, b) => a && b && (slug(a.en) === slug(b.en) || a.gu?.trim() === b.gu?.trim());

const stats = { districts: [0, 0], talukas: [0, 0], villagesNew: 0, villagesLinked: 0, skipped: [] };
const ops = { districts: [], talukas: [], villages: [] };

try {
  await connectDb();

  /* Districts and talukas */
  const gujarat = read('gujarat-talukas.json');
  const existingD = new Map((await District.find().lean()).map((d) => [d.key, d]));
  const existingT = new Map((await Taluka.find().lean()).map((t) => [t.key, t]));
  const talukas = []; // { key, name, district }
  gujarat.districts.forEach((d, di) => {
    const dKey = slug(d.en);
    stats.districts[existingD.has(dKey) ? 1 : 0]++;
    ops.districts.push({ updateOne: { filter: { key: dKey }, update: { $set: { name: loc(d), order: di } }, upsert: true } });
    d.talukas.forEach((t, ti) => {
      if (t.status === 'announced') return stats.skipped.push(`${d.en} / ${t.en} (announced, not notified)`);
      const key = `${dKey}-${slug(t.en)}`;
      stats.talukas[existingT.has(key) ? 1 : 0]++;
      talukas.push({ key, name: loc(t), district: dKey, districtName: loc(d) });
      ops.talukas.push({ updateOne: { filter: { key }, update: { $set: { name: loc(t), district: dKey, order: ti } }, upsert: true } });
    });
  });

  /* Villages */
  const villages = await Village.find().lean();
  const usedKeys = new Set(villages.map((v) => v.key));
  const linkOf = (t) => ({ talukaKey: t.key, taluka: t.name, district: t.districtName });
  let order = Math.max(9, ...villages.map((v) => v.order || 0)) + 1;

  // Find a taluka by name within a district; "X Rural" / "X ગ્રામ્ય" is the taluka "X".
  const findTaluka = (name, district) => {
    const inDistrict = talukas.filter((t) => !district || same(t.districtName, district));
    const base = { gu: name.gu?.replace(/\s*ગ્રામ્ય$/, ''), en: name.en?.replace(/\s+rural$/i, '') };
    return inDistrict.find((t) => same(t.name, name)) || inDistrict.find((t) => same(t.name, base));
  };

  // 1. Village lists: existing villages with the same name are linked (keeping their keys), the rest are added.
  for (const file of readdirSync(DIR).filter((f) => /^villages-.*\.json$/.test(f))) {
    const data = read(file);
    for (const tal of data.talukas) {
      const t = findTaluka(tal, data.district);
      if (!t) {
        stats.skipped.push(`${file}: taluka "${tal.en}" not in the taluka list (${tal.villages.length} villages skipped)`);
        continue;
      }
      for (const raw of tal.villages) {
        const name = loc(raw);
        const existing = villages.find(
          (v) => (v.talukaKey === t.key || !v.talukaKey) && (!v.district || same(v.district, t.districtName)) && same(v.name, name),
        );
        if (existing) {
          if (existing.talukaKey !== t.key) {
            stats.villagesLinked++;
            ops.villages.push({ updateOne: { filter: { _id: existing._id }, update: { $set: linkOf(t) } } });
            Object.assign(existing, linkOf(t));
          }
          continue;
        }
        let key = slug(name.en) || `v-${order}`;
        if (usedKeys.has(key)) key = `${key}-${slug(t.name.en)}`;
        for (let n = 2; usedKeys.has(key); n++) key = `${key.replace(/-\d+$/, '')}-${n}`;
        usedKeys.add(key);
        const doc = { key, name, ...linkOf(t), order: order++ };
        villages.push(doc);
        stats.villagesNew++;
        ops.villages.push({ insertOne: { document: doc } });
      }
    }
  }

  // 2. Remaining unlinked villages: link by their old free-text taluka (and district).
  for (const v of villages) {
    if (v.talukaKey || !v.taluka) continue;
    const t = findTaluka(v.taluka, v.district);
    if (!t) {
      stats.skipped.push(`existing village ${v.key}: no taluka matches "${v.taluka.en}"`);
      continue;
    }
    Object.assign(v, linkOf(t));
    stats.villagesLinked++;
    ops.villages.push({ updateOne: { filter: { _id: v._id }, update: { $set: linkOf(t) } } });
  }

  console.log(`[places] districts: ${stats.districts[0]} new, ${stats.districts[1]} updated`);
  console.log(`[places] talukas:   ${stats.talukas[0]} new, ${stats.talukas[1]} updated`);
  console.log(`[places] villages:  ${stats.villagesNew} new, ${stats.villagesLinked} existing linked to a taluka`);
  stats.skipped.forEach((s) => console.log(`[places] skipped: ${s}`));

  if (!apply) {
    console.log('[places] dry run: nothing written. Re-run with --apply to import.');
  } else {
    if (ops.districts.length) await District.bulkWrite(ops.districts);
    if (ops.talukas.length) await Taluka.bulkWrite(ops.talukas);
    if (ops.villages.length) await Village.bulkWrite(ops.villages);
    console.log('[places] imported');
  }
} catch (err) {
  console.error('[places] failed:', err.message);
  process.exitCode = 1;
} finally {
  await disconnectDb();
}
