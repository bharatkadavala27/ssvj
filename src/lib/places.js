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
export async function placeList() {
  const [villages, talukas, districts] = await Promise.all([
    Village.find().sort({ order: 1 }).lean(),
    Taluka.find().sort({ district: 1, order: 1, 'name.en': 1 }).lean(),
    District.find().sort({ order: 1, 'name.en': 1 }).lean(),
  ]);
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
