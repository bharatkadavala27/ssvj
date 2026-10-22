import { z } from 'zod';
import { Member, RELATIONS } from '../models/index.js';
import { placeExists, placeKeysMatching } from './places.js';
import { HttpError } from '../middleware/errors.js';
import { normalizePhone } from './auth.js';
import { initialOf } from './format.js';

const text = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const optionalPhone = z
  .string()
  .nullish()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const p = normalizePhone(v);
    if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number' });
    return p;
  });

const birthYear = z.preprocess(
  (v) => (v === '' || v == null ? null : Number(v)),
  z
    .number()
    .int()
    .min(1900)
    .nullable()
    .refine((v) => v == null || v <= new Date().getFullYear(), { message: 'Birth year cannot be in the future' }),
);

const personInput = z.object({
  name: z.string().trim().min(1).max(80),
  relation: z.enum(RELATIONS),
  birthYear,
  education: text(80),
  occupation: text(80),
  phone: optionalPhone,
});

/** A family registration as sent by the app or the dashboard. */
export const memberInput = z.object({
  name: z.string().trim().min(2).max(80),
  phone: optionalPhone,
  village: z.string().trim().toLowerCase().min(1).max(60),
  currentPlace: text(80),
  address: text(200),
  birthYear,
  education: text(80),
  occupation: text(80),
  // Length is checked before each person is parsed, so a huge array is rejected cheaply.
  family: z.array(z.unknown()).max(30).pipe(z.array(personInput)).default([]),
});

export async function checkMemberVillage(key) {
  if (!(await placeExists(key))) throw new HttpError(400, 'Unknown village');
}

const people = (m) => 1 + (m.family?.length || 0);

/** What everyone may see: no phone numbers, addresses or family details. */
export function memberPublicView(m) {
  return {
    id: String(m._id || m.id),
    name: m.name,
    initial: initialOf(m.name),
    village: m.village,
    currentPlace: m.currentPlace || null,
    people: people(m),
  };
}

/** Full record for the owner and admins. */
export function memberView(m) {
  const doc = m.toJSON ? m.toJSON() : m;
  return { ...doc, people: people(doc) };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const memberListQuery = z.object({
  village: z.string().optional(),
  q: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

/**
 * Filter by place and a search. The public list searches only what it shows (the head's name, where
 * they live now, place names); `staff` (the dashboard) also searches family members' names and phones.
 */
export async function memberFilter({ village, q }, { staff = false } = {}) {
  const f = {};
  if (village) f.village = village;
  if (q?.trim()) {
    const re = new RegExp(escapeRe(q.trim()), 'i');
    f.$or = [{ name: re }, { currentPlace: re }, { village: { $in: await placeKeysMatching(re) } }];
    if (staff) {
      f.$or.push({ 'family.name': re });
      if (/^\d{3,}$/.test(q.trim())) f.$or.push({ phone: re }, { 'family.phone': re });
    }
  }
  return f;
}

/**
 * The user's own registration. A record the admin entered with the same mobile and no account yet is
 * linked to this account; concurrent calls (or a duplicate) fall back to reading by account.
 */
export async function findOrLinkMember(user) {
  if (!user?.id) return null;
  const mine = await Member.findOne({ userId: user.id });
  if (mine || !user.phone) return mine;
  try {
    const linked = await Member.findOneAndUpdate({ userId: null, phone: user.phone }, { userId: user.id }, { new: true });
    if (linked) return linked;
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
  return Member.findOne({ userId: user.id });
}

/** Families and people per village, largest first, plus the totals. */
export async function memberSummary() {
  const rows = await Member.aggregate([
    { $group: { _id: '$village', families: { $sum: 1 }, people: { $sum: { $add: [1, { $size: { $ifNull: ['$family', []] } }] } } } },
    { $sort: { people: -1, _id: 1 } },
  ]);
  const villages = rows.map((r) => ({ village: r._id, families: r.families, people: r.people }));
  return {
    families: villages.reduce((n, v) => n + v.families, 0),
    people: villages.reduce((n, v) => n + v.people, 0),
    villages,
  };
}
