import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import {
  BANNER_TYPES,
  Banner,
  Campaign,
  Counter,
  District,
  Donation,
  Event,
  Gallery,
  Notification,
  ROLES,
  Report,
  STATUSES,
  Settings,
  Sponsor,
  Taluka,
  User,
  Village,
} from '../models/index.js';
import { adminAuth } from '../middleware/auth.js';
import { HttpError, ah } from '../middleware/errors.js';
import { donationStaffView, receiptData, recordDonation, transitionDonation } from '../lib/donations.js';
import { eventView } from '../lib/format.js';
import { broadcast } from '../lib/live.js';
import { normalizePhone } from '../lib/auth.js';
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
      res.status(201).json(view(doc));
    }),
  );
  router.patch(
    `/${path}/:id`,
    ah(async (req, res) => {
      const body = prepare ? await prepare(req.body || {}) : req.body;
      if (check) {
        const existing = await Model.findById(req.params.id).lean();
        if (!existing) throw new HttpError(404, 'Not found');
        check({ ...existing, ...body });
      }
      const doc = await Model.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
      if (!doc) throw new HttpError(404, 'Not found');
      await after?.(doc);
      refresh();
      res.json(view(doc));
    }),
  );
  router.delete(
    `/${path}/:id`,
    ah(async (req, res) => {
      if (beforeDelete) {
        const existing = await Model.findById(req.params.id);
        if (!existing) throw new HttpError(404, 'Not found');
        await beforeDelete(existing);
      }
      const doc = await Model.findByIdAndDelete(req.params.id);
      if (!doc) throw new HttpError(404, 'Not found');
      refresh();
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
  if (!keys?.length) return;
  const found = await Village.countDocuments({ key: { $in: keys } });
  if (found !== new Set(keys).size) throw new HttpError(400, 'Unknown village in assignment');
}

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
    const user = await User.findOneAndUpdate({ phone: input.phone }, input, { new: true, upsert: true, runValidators: true });
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
    const user = await User.findByIdAndUpdate(req.params.id, input, { new: true, runValidators: true });
    if (!user) throw new HttpError(404, 'Not found');
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
    const settings = await Settings.findByIdAndUpdate('org', fields, { new: true, upsert: true, runValidators: true });
    if (nextReceiptNo != null) {
      // Continue numbering from the paper receipt book, e.g. 557 after slip 556.
      const n = z.coerce.number().int().min(1).parse(nextReceiptNo);
      const last = await Donation.findOne({ receiptNo: { $ne: null } }).sort({ receiptNo: -1 });
      if (last && n <= last.receiptNo) throw new HttpError(400, `Receipt ${last.receiptNo} was already issued; choose a higher number`);
      await Counter.findByIdAndUpdate('receipt', { seq: n - 1 }, { upsert: true });
    }
    refresh();
    res.json(settings);
  }),
);

export default router;
