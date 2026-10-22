import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  Activity,
  ActivityLog,
  BANNER_TYPES,
  Banner,
  Campaign,
  Counter,
  District,
  Donation,
  Event,
  Gallery,
  Member,
  Notification,
  QuickLink,
  ROLES,
  Report,
  STATUSES,
  Settings,
  Sponsor,
  Taluka,
  Trustee,
  TrusteeRole,
  User,
  Village,
  WeddingYear,
} from '../models/index.js';
import { adminAuth } from '../middleware/auth.js';
import { HttpError, ah } from '../middleware/errors.js';
import { deleteDonation, donationStaffView, receiptData, recordDonation, transitionDonation, updateDonation } from '../lib/donations.js';
import { diff, labelOf, logActivity } from '../lib/activity.js';
import { eventView } from '../lib/format.js';
import { broadcast } from '../lib/live.js';
import { normalizePhone } from '../lib/auth.js';
import { checkMemberVillage, memberFilter, memberInput, memberListQuery, memberSummary, memberView } from '../lib/members.js';
import { placeExists, placeList, placesExist } from '../lib/places.js';
import uploadsRouter from './uploads.js';

/** Admin dashboard API. Every route requires an admin account (or the server ADMIN_KEY). */
const router = Router();
router.use(adminAuth);
router.use('/uploads', uploadsRouter);

// Tell open apps to refetch the home payload when content changes.
const refresh = () => broadcast('refresh', { at: Date.now() });

/**
 * Generic list/create/update/delete for a content collection. Optional hooks:
 * `prepare(body)` returns the body to store (async) · `check(record)` may throw an HttpError; on update it
 * sees the stored record merged with the changes · `after(doc)` runs after a save · `beforeDelete(doc)` may throw.
 */
function crud(path, Model, { sort = { order: 1 }, view = (d) => d, prepare, check, after, beforeDelete } = {}) {
  router.get(`/${path}`, ah(async (req, res) => res.json((await Model.find().sort(sort)).map(view))));
  router.post(
    `/${path}`,
    ah(async (req, res) => {
      const body = prepare ? await prepare(req.body || {}) : req.body;
      check?.(body || {});
      const doc = await Model.create(body);
      await after?.(doc);
      refresh();
      await logActivity({ actor: req.user, action: 'create', entity: path, entityId: doc._id, label: labelOf(doc) });
      res.status(201).json(view(doc));
    }),
  );
  router.patch(
    `/${path}/:id`,
    ah(async (req, res) => {
      const body = prepare ? await prepare(req.body || {}) : req.body;
      const existing = await Model.findById(req.params.id).lean();
      if (!existing) throw new HttpError(404, 'Not found');
      check?.({ ...existing, ...body });
      const doc = await Model.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
      if (!doc) throw new HttpError(404, 'Not found');
      await after?.(doc);
      refresh();
      const changes = diff(existing, doc.toObject(), Object.keys(body || {}));
      if (changes.length) await logActivity({ actor: req.user, action: 'update', entity: path, entityId: doc._id, label: labelOf(doc), changes });
      res.json(view(doc));
    }),
  );
  router.delete(
    `/${path}/:id`,
    ah(async (req, res) => {
      const existing = await Model.findById(req.params.id);
      if (!existing) throw new HttpError(404, 'Not found');
      await beforeDelete?.(existing);
      const doc = await Model.findByIdAndDelete(req.params.id);
      if (!doc) throw new HttpError(404, 'Not found');
      refresh();
      await logActivity({ actor: req.user, action: 'delete', entity: path, entityId: doc._id, label: labelOf(doc), snapshot: doc });
      res.status(204).end();
    }),
  );
}

/* ---------------- Districts, talukas, villages ---------------- */

/** A village linked to a taluka gets that taluka's and district's names copied in (receipts print them). */
async function prepareVillage(body) {
  if (!('talukaKey' in body)) return body;
  if (!body.talukaKey) return { ...body, talukaKey: null };
  const taluka = await Taluka.findOne({ key: String(body.talukaKey).toLowerCase() });
  if (!taluka) throw new HttpError(400, 'Unknown taluka');
  const district = await District.findOne({ key: taluka.district });
  return { ...body, talukaKey: taluka.key, taluka: taluka.name, district: district?.name || null };
}

async function checkTalukaDistrict(body) {
  if (body.district && !(await District.exists({ key: String(body.district).toLowerCase() }))) {
    throw new HttpError(400, 'Unknown district');
  }
  return body;
}

/** Keep the copied names on villages in step when a taluka or district is renamed or moved. */
async function syncTalukaVillages(taluka) {
  const district = await District.findOne({ key: taluka.district });
  await Village.updateMany({ talukaKey: taluka.key }, { taluka: taluka.name, district: district?.name || null });
}
async function syncDistrictVillages(district) {
  const keys = (await Taluka.find({ district: district.key }, { key: 1 })).map((t) => t.key);
  if (keys.length) await Village.updateMany({ talukaKey: { $in: keys } }, { district: district.name });
}

async function districtInUse(district) {
  const n = await Taluka.countDocuments({ district: district.key });
  if (n) throw new HttpError(400, `${n} taluka(s) belong to this district; move or delete them first`);
}
async function talukaInUse(taluka) {
  const n = await Village.countDocuments({ talukaKey: taluka.key });
  if (n) throw new HttpError(400, `${n} village(s) are linked to this taluka; relink them first`);
}

crud('districts', District, { sort: { order: 1, 'name.en': 1 }, after: syncDistrictVillages, beforeDelete: districtInUse });
crud('talukas', Taluka, { sort: { district: 1, order: 1, 'name.en': 1 }, prepare: checkTalukaDistrict, after: syncTalukaVillages, beforeDelete: talukaInUse });

/** Required fields depend on the slide type; links must be web, phone or email links. */
function checkBanner(b) {
  const type = b.type || 'donor';
  if (!BANNER_TYPES.includes(type)) throw new HttpError(400, 'Unknown banner type');
  if (!b.photo) throw new HttpError(400, 'A photo is required');
  if (type === 'donor') {
    const d = b.donor || {};
    // Top-donor customisations take village and amount from the live ranking and may leave the cause empty.
    if (!d.name?.gu || !d.initial?.gu || (!b.topDonorId && (!d.village || d.amount == null || !b.cause?.gu))) {
      throw new HttpError(400, 'Donor slides need donor name, initial, village, amount and cause');
    }
  }
  if ((b.buttonText?.gu || b.buttonText?.en) && !b.link) {
    throw new HttpError(400, 'A button needs a link');
  }
  if (b.link && !/^(https?:\/\/|tel:|mailto:)/i.test(b.link)) {
    throw new HttpError(400, 'Link must start with https://, http://, tel: or mailto:');
  }
  if (b.startAt && b.endAt && new Date(b.endAt) <= new Date(b.startAt)) {
    throw new HttpError(400, 'End time must be after the start time');
  }
}

/** Sponsor contact details: web links must be http(s), phone numbers need 10+ digits. */
function checkSponsor(s) {
  for (const k of ['mapUrl', 'website', 'facebook', 'instagram', 'youtube', 'buttonLink']) {
    if (s[k] && !/^https?:\/\//i.test(s[k])) throw new HttpError(400, `${k} must start with https:// or http://`);
  }
  for (const k of ['phone', 'whatsapp']) {
    if (s[k] && String(s[k]).replace(/\D/g, '').length < 10) throw new HttpError(400, `${k} must have at least 10 digits`);
  }
  if (s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) throw new HttpError(400, 'Email address is not valid');
  if ((s.buttonText?.gu || s.buttonText?.en) && !s.buttonLink) throw new HttpError(400, 'The extra button needs a link');
}

crud('campaigns', Campaign);
crud('villages', Village, { prepare: prepareVillage });
crud('sponsors', Sponsor, { check: checkSponsor });
crud('banners', Banner, { check: checkBanner });
crud('gallery', Gallery);
crud('reports', Report, { sort: { year: -1, createdAt: -1 } });
crud('events', Event, { sort: { date: 1 }, view: eventView });
crud('notifications', Notification, { sort: { createdAt: -1 } });

/* ---------------- Quick links, activities, mass wedding years ---------------- */

function checkQuickLink(q) {
  if (q.action === 'link' && !/^(https?:\/\/|tel:|mailto:)/i.test(q.link || '')) {
    throw new HttpError(400, 'A link tile needs a link starting with https://, http://, tel: or mailto:');
  }
}

async function quickLinkInUse(q) {
  const n = await Activity.countDocuments({ section: q.key });
  if (n) throw new HttpError(400, `${n} activit${n === 1 ? 'y belongs' : 'ies belong'} to this tile; move or delete them first`);
}

async function prepareActivity(body) {
  if ('section' in body && !(await QuickLink.exists({ key: String(body.section || '').toLowerCase() }))) {
    throw new HttpError(400, 'Choose the page (quick link) this activity belongs to');
  }
  return body;
}

/** Drops empty rows the dashboard's list editors may send. */
function prepareWedding(body) {
  const rows = (list, key) => (Array.isArray(list) ? list.filter((r) => String(r?.[key] ?? '').trim()) : list);
  return { ...body, donors: rows(body.donors, 'name'), expenses: rows(body.expenses, 'item'), facts: rows(body.facts, 'label') };
}

crud('quick-links', QuickLink, { check: checkQuickLink, beforeDelete: quickLinkInUse });
crud('activities', Activity, { sort: { section: 1, order: 1, date: -1 }, prepare: prepareActivity });
crud('weddings', WeddingYear, { sort: { order: 1, year: -1 }, prepare: prepareWedding });

/* ---------------- Trustees ---------------- */

async function trusteeRoleInUse(role) {
  const n = await Trustee.countDocuments({ role: role.key });
  if (n) throw new HttpError(400, `${n} trustee(s) have this designation; change or delete them first`);
}

async function prepareTrustee(body) {
  if ('role' in body && !(await TrusteeRole.exists({ key: String(body.role || '').toLowerCase() }))) {
    throw new HttpError(400, 'Choose a designation');
  }
  if (body.phone && String(body.phone).replace(/\D/g, '').length < 10) throw new HttpError(400, 'phone must have at least 10 digits');
  if (body.village && !(await placeExists(String(body.village).toLowerCase()))) throw new HttpError(400, 'Unknown village');
  return body;
}

/** Changing a designation's key moves its trustees along (runs before the generic update below). */
router.patch(
  '/trustee-roles/:id',
  ah(async (req, res, next) => {
    const key = String(req.body?.key || '').trim().toLowerCase();
    const old = key && mongoose.isValidObjectId(req.params.id) && (await TrusteeRole.findById(req.params.id));
    if (old && old.key !== key) {
      if (await TrusteeRole.exists({ key })) throw new HttpError(409, 'Another designation already uses this key');
      await Trustee.updateMany({ role: old.key }, { role: key });
    }
    next();
  }),
);
crud('trustee-roles', TrusteeRole, { beforeDelete: trusteeRoleInUse });
crud('trustees', Trustee, { sort: { order: 1, createdAt: 1 }, prepare: prepareTrustee });

/* ---------------- Members (family registrations) ---------------- */

router.get(
  '/members',
  ah(async (req, res) => {
    const q = memberListQuery.parse(req.query);
    const filter = await memberFilter(q);
    const [items, total] = await Promise.all([
      Member.find(filter).sort({ village: 1, name: 1 }).skip(q.skip).limit(q.limit),
      Member.countDocuments(filter),
    ]);
    res.json({ total, items: items.map(memberView) });
  }),
);

router.get('/members/summary', ah(async (req, res) => res.json(await memberSummary())));

router.post(
  '/members',
  ah(async (req, res) => {
    const input = memberInput.parse(req.body);
    await checkMemberVillage(input.village);
    const doc = await Member.create({ ...input, source: 'admin' });
    await logActivity({ actor: req.user, action: 'create', entity: 'members', entityId: doc._id, label: doc.name });
    res.status(201).json(memberView(doc));
  }),
);

router.patch(
  '/members/:id',
  ah(async (req, res) => {
    const input = memberInput.parse(req.body);
    await checkMemberVillage(input.village);
    const existing = await Member.findById(req.params.id).lean();
    if (!existing) throw new HttpError(404, 'Not found');
    const doc = await Member.findByIdAndUpdate(req.params.id, input, { new: true, runValidators: true });
    const changes = diff(existing, doc.toObject(), Object.keys(input));
    if (changes.length) await logActivity({ actor: req.user, action: 'update', entity: 'members', entityId: doc._id, label: doc.name, changes });
    res.json(memberView(doc));
  }),
);

router.delete(
  '/members/:id',
  ah(async (req, res) => {
    const doc = await Member.findByIdAndDelete(req.params.id);
    if (!doc) throw new HttpError(404, 'Not found');
    await logActivity({ actor: req.user, action: 'delete', entity: 'members', entityId: doc._id, label: doc.name, snapshot: doc });
    res.status(204).end();
  }),
);

/* ---------------- Users & roles ---------------- */

const phoneField = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number' });
  return p;
});
const userInput = z.object({
  name: z.string().trim().min(2).max(60),
  phone: phoneField,
  role: z.enum(ROLES).default('public'),
  villages: z.array(z.string()).default([]),
  active: z.boolean().default(true),
});

async function checkVillages(keys) {
  if (keys?.length && !(await placesExist(keys))) throw new HttpError(400, 'Unknown village in assignment');
}

/** Villages, talukas ("taluka:<key>") and districts ("district:<key>") for the dashboard's place pickers. */
router.get('/places', ah(async (req, res) => res.json(await placeList())));

router.get(
  '/users',
  ah(async (req, res) => {
    const q = z.object({ role: z.enum(ROLES).optional(), q: z.string().max(40).optional() }).parse(req.query);
    const filter = {};
    if (q.role) filter.role = q.role;
    if (q.q) filter.$or = [{ name: new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { phone: new RegExp(q.q.replace(/\D/g, '') || '^$') }];
    res.json(await User.find(filter).sort({ role: -1, name: 1 }).limit(500));
  }),
);

router.post(
  '/users',
  ah(async (req, res) => {
    const input = userInput.parse(req.body);
    await checkVillages(input.villages);
    // An existing public account (someone who already logged in) is upgraded in place.
    const existing = await User.findOne({ phone: input.phone }).lean();
    const user = await User.findOneAndUpdate({ phone: input.phone }, input, { new: true, upsert: true, runValidators: true });
    await logActivity({
      actor: req.user,
      action: existing ? 'update' : 'create',
      entity: 'users',
      entityId: user._id,
      label: `${user.name || ''} ${user.phone}`.trim(),
      changes: diff(existing || {}, user.toObject(), ['name', 'role', 'villages', 'active']),
    });
    res.status(201).json(user);
  }),
);

router.patch(
  '/users/:id',
  ah(async (req, res) => {
    const input = userInput.partial().parse(req.body);
    await checkVillages(input.villages);
    if (req.user.id && String(req.user.id) === req.params.id && input.role && input.role !== 'admin') {
      throw new HttpError(400, 'You cannot remove your own admin role');
    }
    const existing = await User.findById(req.params.id).lean();
    if (!existing) throw new HttpError(404, 'Not found');
    const user = await User.findByIdAndUpdate(req.params.id, input, { new: true, runValidators: true });
    const changes = diff(existing, user.toObject(), Object.keys(input));
    if (changes.length) await logActivity({ actor: req.user, action: 'update', entity: 'users', entityId: user._id, label: `${user.name || ''} ${user.phone}`.trim(), changes });
    res.json(user);
  }),
);

/* ---------------- Donations ---------------- */

const listQuery = z.object({
  status: z.enum(STATUSES).optional(),
  campaign: z.string().optional(),
  village: z.string().optional(),
  sevak: z.string().optional(), // user id of the collector
  q: z.string().max(60).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  skip: z.coerce.number().int().min(0).default(0),
});

function donationFilter(q) {
  const f = {};
  if (q.status) f.status = q.status;
  if (q.campaign) f.campaign = q.campaign;
  if (q.village) f.village = q.village;
  if (q.sevak && mongoose.isValidObjectId(q.sevak)) f['collectedBy.id'] = new mongoose.Types.ObjectId(q.sevak);
  if (q.from || q.to) {
    f.createdAt = {};
    if (q.from) f.createdAt.$gte = new Date(`${q.from}T00:00:00+05:30`);
    if (q.to) f.createdAt.$lte = new Date(`${q.to}T23:59:59.999+05:30`);
  }
  if (q.q) {
    const re = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const or = [{ 'name.gu': re }, { 'name.en': re }, { phone: re }];
    if (/^\d+$/.test(q.q)) or.push({ receiptNo: Number(q.q) });
    f.$or = or;
  }
  return f;
}

router.get(
  '/donations',
  ah(async (req, res) => {
    const q = listQuery.parse(req.query);
    const filter = donationFilter(q);
    const [items, total] = await Promise.all([
      Donation.find(filter).select('+phone').sort({ createdAt: -1 }).skip(q.skip).limit(q.limit),
      Donation.countDocuments(filter),
    ]);
    res.json({ total, items: items.map(donationStaffView) });
  }),
);

router.get(
  '/donations/:id',
  ah(async (req, res) => {
    const doc = await Donation.findById(req.params.id).select('+phone');
    if (!doc) throw new HttpError(404, 'Not found');
    res.json({ ...(await receiptData(doc)), donation: donationStaffView(doc) });
  }),
);

/** Record a donation directly (e.g. at the samaj office); it is approved immediately. */
router.post(
  '/donations',
  ah(async (req, res) => {
    const input = z
      .object({
        campaign: z.string(),
        village: z.string(),
        amount: z.coerce.number().int().min(1).optional(),
        material: z.string().trim().min(1).max(120).optional(),
        name: z.string().trim().max(80).optional(),
        nameEn: z.string().trim().max(80).optional(),
        anon: z.boolean().default(false),
        phone: z.string().optional().transform((v) => (v ? normalizePhone(v) || undefined : undefined)),
        details: z.string().trim().max(200).optional(),
        through: z.string().trim().max(80).optional(),
        business: z.string().trim().max(120).optional(),
        currentPlace: z.string().trim().max(60).optional(),
      })
      .refine((d) => d.amount || d.material, { message: 'amount or material is required' })
      .parse(req.body);
    const { doc } = await recordDonation(input, { source: 'admin', status: 'approved', actor: req.user });
    res.status(201).json(await receiptData(doc));
  }),
);

/** Approve, reject or restore a donation. */
router.patch(
  '/donations/:id',
  ah(async (req, res) => {
    const { status, reason } = z
      .object({ status: z.enum(['collected', 'approved', 'rejected', 'pledged']), reason: z.string().trim().max(200).optional() })
      .parse(req.body);
    const doc = await transitionDonation(req.params.id, status, req.user, { reason });
    res.json(donationStaffView(doc));
  }),
);

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const nullableNumber = z.preprocess((v) => (v === '' || v == null ? null : Number(v)), z.number().int().min(1).nullable());

/** Admin edit of a donation's details (status changes go through PATCH). */
const donationEdit = z.object({
  campaign: z.string().min(1).optional(),
  village: z.string().min(1).max(80).optional(),
  name: z.string().trim().max(80).optional(),
  nameEn: optionalText(80),
  amount: nullableNumber.optional(),
  material: optionalText(120),
  anon: z.boolean().optional(),
  phone: z
    .string()
    .nullish()
    .transform((v, ctx) => {
      if (!v || !v.trim()) return null;
      const p = normalizePhone(v);
      if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number' });
      return p;
    }),
  details: optionalText(200),
  through: optionalText(80),
  business: optionalText(120),
  currentPlace: optionalText(60),
  receiptNo: nullableNumber.optional(),
});

router.put(
  '/donations/:id',
  ah(async (req, res) => {
    const input = donationEdit.parse(req.body);
    const doc = await updateDonation(req.params.id, input, req.user);
    res.json(donationStaffView(doc));
  }),
);

router.delete(
  '/donations/:id',
  ah(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().max(200).optional() }).parse(req.query);
    await deleteDonation(req.params.id, req.user, { reason });
    res.status(204).end();
  }),
);

/** Full history of one donation, oldest first. */
router.get(
  '/donations/:id/activity',
  ah(async (req, res) => res.json(await ActivityLog.find({ entity: 'donation', entityId: req.params.id }).sort({ createdAt: 1 }))),
);

/** Approve, reject or delete many donations at once; each one reports its own result. */
router.post(
  '/donations/bulk',
  ah(async (req, res) => {
    const { ids, action, reason } = z
      .object({ ids: z.array(z.string()).min(1).max(500), action: z.enum(['approve', 'reject', 'delete']), reason: z.string().trim().max(200).optional() })
      .parse(req.body);
    const results = [];
    for (const id of ids) {
      try {
        if (action === 'delete') await deleteDonation(id, req.user, { reason });
        else await transitionDonation(id, action === 'approve' ? 'approved' : 'rejected', req.user, { reason });
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: err.message });
      }
    }
    res.json({ results });
  }),
);

/** Approve many collected donations at once (e.g. after a sevak deposits the day's cash). */
router.post(
  '/donations/approve',
  ah(async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(500) }).parse(req.body);
    const results = [];
    for (const id of ids) {
      try {
        await transitionDonation(id, 'approved', req.user);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: err.message });
      }
    }
    res.json({ results });
  }),
);

/* ---------------- Activity log ---------------- */

router.get(
  '/activity',
  ah(async (req, res) => {
    const q = z
      .object({
        entity: z.string().max(40).optional(),
        action: z.string().max(20).optional(),
        actor: z.string().optional(),
        q: z.string().max(60).optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        skip: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    const f = {};
    if (q.entity) f.entity = q.entity;
    if (q.action) f.action = q.action;
    if (q.actor && mongoose.isValidObjectId(q.actor)) f['actor.id'] = new mongoose.Types.ObjectId(q.actor);
    if (q.from || q.to) {
      f.createdAt = {};
      if (q.from) f.createdAt.$gte = new Date(`${q.from}T00:00:00+05:30`);
      if (q.to) f.createdAt.$lte = new Date(`${q.to}T23:59:59.999+05:30`);
    }
    if (q.q) {
      const re = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      f.$or = [{ label: re }, { note: re }, { 'actor.name': re }, { 'actor.phone': re }];
    }
    const [items, total, actors] = await Promise.all([
      ActivityLog.find(f).select('-snapshot').sort({ createdAt: -1 }).skip(q.skip).limit(q.limit),
      ActivityLog.countDocuments(f),
      ActivityLog.aggregate([{ $match: { 'actor.id': { $ne: null } } }, { $group: { _id: '$actor.id', name: { $last: '$actor.name' }, phone: { $last: '$actor.phone' } } }]),
    ]);
    res.json({ total, items, actors: actors.map((a) => ({ id: String(a._id), name: a.name, phone: a.phone })) });
  }),
);

router.get(
  '/activity/:id',
  ah(async (req, res) => {
    const doc = await ActivityLog.findById(req.params.id);
    if (!doc) throw new HttpError(404, 'Not found');
    res.json(doc);
  }),
);

/* ---------------- Dashboard analytics ---------------- */

const IST = 330 * 60000;
const DAY = 864e5;
/** Start of the hour / day / week (Monday) / month containing t, in India time. */
function truncIST(t, unit) {
  const x = t + IST;
  if (unit === 'hour') return Math.floor(x / 36e5) * 36e5 - IST;
  const day = Math.floor(x / DAY) * DAY;
  if (unit === 'day') return day - IST;
  if (unit === 'week') return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY - IST;
  const d = new Date(day);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - IST;
}
function nextIST(t, unit) {
  if (unit === 'hour') return t + 36e5;
  if (unit === 'day') return t + DAY;
  if (unit === 'week') return t + 7 * DAY;
  const d = new Date(t + IST);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - IST;
}

const SIZE_BANDS = [
  [1, 500, '≤ ₹500'],
  [501, 1100, '₹501–1,100'],
  [1101, 5000, '₹1,101–5,000'],
  [5001, 11000, '₹5,001–11,000'],
  [11001, 51000, '₹11,001–51,000'],
  [51001, Infinity, '₹51,001+'],
];

const donorKey = (d) => (d.anon ? `anon:${d._id}` : `${d.village}|${d.name?.gu}`);

function totalsOf(list) {
  const live = list.filter((d) => d.status !== 'rejected');
  const cash = live.filter((d) => !d.material);
  const amount = cash.reduce((n, d) => n + (d.amount || 0), 0);
  return {
    amount,
    count: live.length,
    donors: new Set(live.map(donorKey)).size,
    average: cash.length ? Math.round(amount / cash.length) : 0,
    inKind: live.length - cash.length,
  };
}

function groupBy(list, keyOf, init) {
  const m = new Map();
  for (const d of list) {
    const k = keyOf(d);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, init(d));
    const g = m.get(k);
    g.count += 1;
    g.amount += d.amount || 0;
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount || b.count - a.count);
}

/**
 * Everything the dashboard shows for one period (and campaign): totals with the previous period of the same
 * length, a time series (hourly, daily, weekly or monthly), status pipeline, villages, sevaks, sources,
 * gift sizes, top donors, recent donations, campaign progress, and community counts.
 */
router.get(
  '/insights',
  ah(async (req, res) => {
    const q = z.object({ campaign: z.string().optional(), from: z.string().date().optional(), to: z.string().date().optional() }).parse(req.query);
    const base = q.campaign ? { campaign: q.campaign } : {};
    const now = Date.now();
    const first = q.from ? null : await Donation.findOne(base).sort({ createdAt: 1 }).select('createdAt').lean();
    const start = q.from ? new Date(`${q.from}T00:00:00+05:30`).getTime() : first ? first.createdAt.getTime() : now - 30 * DAY;
    const end = q.to ? Math.min(now, new Date(`${q.to}T23:59:59.999+05:30`).getTime()) : now;
    const span = Math.max(36e5, end - start);
    const days = span / DAY;
    const unit = days <= 2 ? 'hour' : days <= 92 ? 'day' : days <= 550 ? 'week' : 'month';
    const fields = 'campaign name village amount material anon status source collectedBy receiptNo createdAt';
    const sumAmount = { $sum: { $ifNull: ['$amount', 0] } };
    const [docs, prevDocs, campaigns, pending, pledgedOpen, community, sevaks, upcomingEvents] = await Promise.all([
      Donation.find({ ...base, createdAt: { $gte: new Date(start), $lte: new Date(end) } }).select(fields).sort({ createdAt: -1 }).lean(),
      q.from ? Donation.find({ ...base, createdAt: { $gte: new Date(start - span), $lt: new Date(start) } }).select('name village amount material anon status').lean() : null,
      Campaign.find().sort({ order: 1 }).lean(),
      Donation.aggregate([{ $match: { ...base, status: 'collected' } }, { $group: { _id: null, count: { $sum: 1 }, amount: sumAmount } }]),
      Donation.aggregate([{ $match: { ...base, status: 'pledged' } }, { $group: { _id: null, count: { $sum: 1 }, amount: sumAmount } }]),
      memberSummary(),
      User.countDocuments({ role: 'sevak', active: true }),
      Event.countDocuments({ published: true, date: { $gte: new Date() } }),
    ]);
    const live = docs.filter((d) => d.status !== 'rejected');

    const buckets = new Map();
    for (let t = truncIST(start, unit); t <= end && buckets.size < 800; t = nextIST(t, unit)) buckets.set(t, { t, amount: 0, count: 0 });
    for (const d of live) {
      const b = buckets.get(truncIST(d.createdAt.getTime(), unit));
      if (b) {
        b.amount += d.amount || 0;
        b.count += 1;
      }
    }

    const byStatus = Object.fromEntries(['pledged', 'collected', 'approved', 'rejected'].map((st) => [st, { count: 0, amount: 0 }]));
    for (const d of docs) {
      byStatus[d.status].count += 1;
      byStatus[d.status].amount += d.amount || 0;
    }
    const villages = groupBy(live, (d) => d.village, (d) => ({ village: d.village, count: 0, amount: 0 }));
    const bySevak = groupBy(
      live.filter((d) => d.collectedBy?.id),
      (d) => String(d.collectedBy.id),
      (d) => ({ id: String(d.collectedBy.id), name: d.collectedBy.name, count: 0, amount: 0, awaiting: 0 }),
    );
    for (const d of live) {
      if (d.status !== 'collected' || !d.collectedBy?.id) continue;
      const s = bySevak.find((x) => x.id === String(d.collectedBy.id));
      if (s) s.awaiting += d.amount || 0;
    }
    const bySource = groupBy(live, (d) => (d.source === 'seed' ? 'admin' : d.source), (d) => ({ source: d.source === 'seed' ? 'admin' : d.source, count: 0, amount: 0 }));
    const cash = live.filter((d) => !d.material && d.amount > 0);
    const sizes = SIZE_BANDS.map(([lo, hi, label]) => {
      const inBand = cash.filter((d) => d.amount >= lo && d.amount <= hi);
      return { label, count: inBand.length, amount: inBand.reduce((n, d) => n + d.amount, 0) };
    });
    const topDonors = groupBy(cash.filter((d) => !d.anon), donorKey, (d) => ({ name: d.name, village: d.village, count: 0, amount: 0 })).slice(0, 8);

    res.json({
      range: { from: start, to: end, unit, allTime: !q.from },
      totals: totalsOf(docs),
      previous: prevDocs && totalsOf(prevDocs),
      series: [...buckets.values()],
      byStatus,
      byVillage: villages.slice(0, 12),
      villageCount: villages.length,
      bySevak,
      bySource,
      sizes,
      topDonors,
      recent: docs.slice(0, 12).map((d) => ({
        id: String(d._id),
        name: d.name,
        village: d.village,
        amount: d.amount,
        material: d.material,
        status: d.status,
        source: d.source,
        receiptNo: d.receiptNo,
        collectedBy: d.collectedBy?.name || null,
        createdAt: d.createdAt,
      })),
      campaigns: campaigns.map((c) => ({
        key: c.key,
        label: c.label,
        target: c.target,
        collected: c.collected,
        donors: c.donors,
        villages: c.villages,
        active: c.active,
        date: c.poster?.date || null,
      })),
      pending: { count: pending[0]?.count || 0, amount: pending[0]?.amount || 0 },
      pledgedOpen: { count: pledgedOpen[0]?.count || 0, amount: pledgedOpen[0]?.amount || 0 },
      community: { families: community.families, people: community.people, memberVillages: community.villages.length, sevaks, upcomingEvents },
    });
  }),
);

/* ---------------- Collection summary ---------------- */

router.get(
  '/summary',
  ah(async (req, res) => {
    const q = listQuery.pick({ campaign: true, from: true, to: true }).parse(req.query);
    const match = { ...donationFilter(q), status: { $ne: 'rejected' } };
    const amount = { $sum: { $ifNull: ['$amount', 0] } };
    const [byStatus, byCampaign, byVillage, bySevak, daily, campaigns, villages, pendingApproval] = await Promise.all([
      Donation.aggregate([{ $match: donationFilter(q) }, { $group: { _id: '$status', count: { $sum: 1 }, amount } }]),
      Donation.aggregate([{ $match: match }, { $group: { _id: '$campaign', count: { $sum: 1 }, amount } }]),
      Donation.aggregate([{ $match: match }, { $group: { _id: '$village', count: { $sum: 1 }, amount } }, { $sort: { amount: -1 } }]),
      Donation.aggregate([
        { $match: { ...match, 'collectedBy.id': { $ne: null } } },
        {
          $group: {
            _id: '$collectedBy.id',
            name: { $first: '$collectedBy.name' },
            count: { $sum: 1 },
            amount,
            awaiting: { $sum: { $cond: [{ $eq: ['$status', 'collected'] }, { $ifNull: ['$amount', 0] }, 0] } },
          },
        },
        { $sort: { amount: -1 } },
      ]),
      Donation.aggregate([
        { $match: { ...match, createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } }, count: { $sum: 1 }, amount } },
        { $sort: { _id: 1 } },
      ]),
      Campaign.find().sort({ order: 1 }),
      Village.find().sort({ order: 1 }),
      Donation.countDocuments({ status: 'collected' }),
    ]);
    res.json({
      byStatus: Object.fromEntries(byStatus.map((s) => [s._id, { count: s.count, amount: s.amount }])),
      byCampaign: byCampaign.map((c) => ({ campaign: c._id, count: c.count, amount: c.amount })),
      byVillage: byVillage.map((v) => ({ village: v._id, count: v.count, amount: v.amount })),
      bySevak: bySevak.map((s) => ({ id: String(s._id), name: s.name, count: s.count, amount: s.amount, awaiting: s.awaiting })),
      daily: daily.map((d) => ({ date: d._id, count: d.count, amount: d.amount })),
      campaigns,
      villages,
      pendingApproval,
    });
  }),
);

/* ---------------- Settings ---------------- */

router.get(
  '/settings',
  ah(async (req, res) => {
    const [settings, counter] = await Promise.all([Settings.findById('org'), Counter.findById('receipt')]);
    res.json({ settings, nextReceiptNo: (counter?.seq || 0) + 1 });
  }),
);

router.patch(
  '/settings',
  ah(async (req, res) => {
    const { nextReceiptNo, ...fields } = req.body || {};
    const before = (await Settings.findById('org').lean()) || {};
    const settings = await Settings.findByIdAndUpdate('org', fields, { new: true, upsert: true, runValidators: true });
    const changes = diff(before, settings.toObject(), Object.keys(fields));
    if (nextReceiptNo != null) {
      // Continue numbering from the paper receipt book, e.g. 557 after slip 556.
      const n = z.coerce.number().int().min(1).parse(nextReceiptNo);
      const last = await Donation.findOne({ receiptNo: { $ne: null } }).sort({ receiptNo: -1 });
      if (last && n <= last.receiptNo) throw new HttpError(400, `Receipt ${last.receiptNo} was already issued; choose a higher number`);
      const counter = await Counter.findById('receipt');
      await Counter.findByIdAndUpdate('receipt', { seq: n - 1 }, { upsert: true });
      changes.push({ field: 'nextReceiptNo', from: (counter?.seq || 0) + 1, to: n });
    }
    if (changes.length) await logActivity({ actor: req.user, action: 'update', entity: 'settings', entityId: 'org', label: 'Settings', changes });
    refresh();
    res.json(settings);
  }),
);

export default router;
