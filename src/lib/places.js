import { District, Taluka, Village } from '../models/index.js';

/**
 * A donor's or member's place is stored as one key: a village key ("keshod"), or a whole taluka
 * ("taluka:<taluka key>") or district ("district:<district key>") for people who don't give a village.
 */
export const placeKind = (key) => {
  const k = String(key || '');
  if (k.startsWith('taluka:')) return 'taluka';
  if (k.startsWith('district:')) return 'district';
  return 'village';
};
const bareKey = (key) => String(key).slice(String(key).indexOf(':') + 1);

const SUFFIX = { taluka: { gu: 'તાલુકો', en: 'taluka' }, district: { gu: 'જિલ્લો', en: 'district' } };
/** "કેશોદ તાલુકો · Keshod taluka", "જૂનાગઢ જિલ્લો · Junagadh district": the name shown in lists and pickers. */
const label = (name, kind) => ({ gu: `${name.gu} ${SUFFIX[kind].gu}`, en: `${name.en || name.gu} ${SUFFIX[kind].en}` });

export async function placeExists(key) {
  const kind = placeKind(key);
  if (kind === 'taluka') return Boolean(await Taluka.exists({ key: bareKey(key) }));
  if (kind === 'district') return Boolean(await District.exists({ key: bareKey(key) }));
  return Boolean(await Village.exists({ key }));
}

export async function placesExist(keys = []) {
  const results = await Promise.all([...new Set(keys)].map(placeExists));
  return results.every(Boolean);
}

/**
 * Every place, for pickers: villages first, then talukas and districts. `sub` is the line shown under
 * the name (a village's taluka, a taluka's district).
 */
let cached = null;
/** Forget the cached place list (after villages, talukas or districts change). */
export function clearPlaceCache() {
  cached = null;
}

export async function placeList() {
  // Read on every /home request, so kept in memory (single process); the admin routes clear it on
  // changes and it expires after 10 minutes for edits made by scripts such as import-places.
  return (await placeData()).list;
}

/** The place list plus a version string that changes whenever a village, taluka or district changes. */
export async function placeData() {
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached;
  const [villages, talukas, districts] = await Promise.all([
    Village.find().sort({ order: 1 }).lean(),
    Taluka.find().sort({ district: 1, order: 1, 'name.en': 1 }).lean(),
    District.find().sort({ order: 1, 'name.en': 1 }).lean(),
  ]);
  const all = [...villages, ...talukas, ...districts];
  const latest = Math.max(0, ...all.map((p) => new Date(p.updatedAt || 0).getTime()));
  cached = { at: Date.now(), list: buildPlaceList(villages, talukas, districts), version: `${all.length}-${latest}` };
  return cached;
}

function buildPlaceList(villages, talukas, districts) {
  const districtName = new Map(districts.map((d) => [d.key, d.name]));
  return [
    ...villages.map((v) => ({ key: v.key, kind: 'village', name: v.name, sub: v.taluka || null, taluka: v.taluka, district: v.district, talukaKey: v.talukaKey })),
    ...talukas.map((t) => {
      const district = districtName.get(t.district) || null;
      return { key: `taluka:${t.key}`, kind: 'taluka', name: label(t.name, 'taluka'), sub: district && label(district, 'district'), taluka: t.name, district };
    }),
    ...districts.map((d) => ({ key: `district:${d.key}`, kind: 'district', name: label(d.name, 'district'), sub: null, taluka: null, district: d.name })),
  ];
}

/** The place printed on a receipt: ગામ, તાલુકો, જીલ્લો (ગામ stays empty for a taluka or district). */
export async function placeInfo(key) {
  const kind = placeKind(key);
  if (kind === 'village') {
    const v = await Village.findOne({ key });
    return v && { key, kind, name: v.name, taluka: v.taluka, district: v.district };
  }
  if (kind === 'taluka') {
    const t = await Taluka.findOne({ key: bareKey(key) });
    if (!t) return null;
    const d = await District.findOne({ key: t.district });
    return { key, kind, name: null, taluka: t.name, district: d?.name || null };
  }
  const d = await District.findOne({ key: bareKey(key) });
  return d && { key, kind, name: null, taluka: null, district: d.name };
}

/**
 * Every place key a set of sevak assignments covers: an assigned taluka covers its villages, an assigned
 * district its talukas and their villages. Keys are lowercase.
 */
export async function coveredPlaces(assigned = []) {
  const keys = new Set(assigned.map((k) => String(k).toLowerCase()));
  const districts = [...keys].filter((k) => placeKind(k) === 'district').map(bareKey);
  let talukas = [...keys].filter((k) => placeKind(k) === 'taluka').map(bareKey);
  if (districts.length) {
    const inDistricts = (await Taluka.find({ district: { $in: districts } }, { key: 1 }).lean()).map((t) => t.key);
    talukas = [...new Set([...talukas, ...inDistricts])];
  }
  for (const t of talukas) keys.add(`taluka:${t}`);
  if (talukas.length) {
    for (const v of await Village.find({ talukaKey: { $in: talukas } }, { key: 1 }).lean()) keys.add(v.key);
  }
  return keys;
}

/** Keys of every place (village, "taluka:<key>", "district:<key>") whose Gujarati or English name matches `re`. */
export async function placeKeysMatching(re) {
  const byName = { $or: [{ 'name.gu': re }, { 'name.en': re }] };
  const [villages, talukas, districts] = await Promise.all([
    Village.find(byName, { key: 1 }).lean(),
    Taluka.find(byName, { key: 1 }).lean(),
    District.find(byName, { key: 1 }).lean(),
  ]);
  return [...villages.map((v) => v.key), ...talukas.map((t) => `taluka:${t.key}`), ...districts.map((d) => `district:${d.key}`)];
}

/** Places for a list of keys (a sevak's assignments), in list order, with display names. */
export async function placesByKeys(keys = []) {
  if (!keys.length) return [];
  const of = (kind) => keys.filter((k) => placeKind(k) === kind);
  const [villages, talukas, districts] = await Promise.all([
    Village.find({ key: { $in: of('village') } }).sort({ order: 1 }).lean(),
    Taluka.find({ key: { $in: of('taluka').map(bareKey) } }).lean(),
    District.find({ key: { $in: of('district').map(bareKey) } }).lean(),
  ]);
  return [
    ...villages.map((v) => ({ key: v.key, kind: 'village', name: v.name, taluka: v.taluka, district: v.district })),
    ...talukas.map((t) => ({ key: `taluka:${t.key}`, kind: 'taluka', name: label(t.name, 'taluka') })),
    ...districts.map((d) => ({ key: `district:${d.key}`, kind: 'district', name: label(d.name, 'district') })),
  ];
}
