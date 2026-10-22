import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import mongoose from 'mongoose';
import {
  Activity,
  Banner,
  Campaign,
  Donation,
  Event,
  Gallery,
  Member,
  Notification,
  QuickLink,
  Report,
  Settings,
  Sponsor,
  Trustee,
  TrusteeRole,
  User,
  WeddingYear,
} from '../models/index.js';
import { HttpError, ah } from '../middleware/errors.js';
import { loadUser, requireRole } from '../middleware/auth.js';
import { safeEqual } from '../lib/auth.js';
import { campaignStats, donationView, receiptData, recordDonation, topDonors } from '../lib/donations.js';
import { eventView } from '../lib/format.js';
import { subscribe } from '../lib/live.js';
import { cloudinaryReady } from '../lib/cloudinary.js';
import { placeKeysMatching, placeList } from '../lib/places.js';
import { logActivity } from '../lib/activity.js';
import { checkMemberVillage, findOrLinkMember, memberFilter, memberInput, memberListQuery, memberPublicView, memberSummary, memberView } from '../lib/members.js';

const router = Router();
const visible = { status: { $ne: 'rejected' } };
const RECENT_PER_CAMPAIGN = 20;

const campaignView = (c) => ({ ...campaignStats(c), label: c.label, poster: c.poster, gauge: c.gauge });

async function upcomingEvents() {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const events = await Event.find({ published: true, date: { $gte: since } }).sort({ date: 1 }).limit(20);
  return events.map(eventView);
}

/**
 * Active slides whose schedule includes now (empty start/end means no limit). Top-donor customisations are
 * sent even when switched off, so the app can hide that donor's automatic slide too.
 */
function liveBanners(now = new Date()) {
  return Banner.find({
    $and: [
      { $or: [{ active: true }, { topDonorId: { $ne: null } }] },
      { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
      { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
    ],
  }).sort({ order: 1 });
}

/**
 * Uptime check (UptimeRobot pings it every 5 minutes, which also keeps a free Render instance awake).
 * 503 when the database is disconnected, so the monitor alerts on a real outage. No DB query: cheap to hit.
 */
router.get('/health', (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.set('Cache-Control', 'no-store');
  res.status(dbUp ? 200 : 503).json({
    ok: dbUp,
    db: dbUp ? 'up' : 'down',
    uploads: cloudinaryReady ? 'enabled' : 'disabled',
    uptime: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

/** Everything the home screen needs in one request. */
router.get(
  '/home',
  ah(async (req, res) => {
    const campaigns = await Campaign.find({ active: true }).sort({ order: 1 });
    const [recentLists, top, banners, sponsors, events, notifications, villages, settings, gallery, reports, trusteeRoles, trustees, quickLinks] = await Promise.all([
      Promise.all(
        campaigns.map((c) => Donation.find({ ...visible, campaign: c.key }).sort({ createdAt: -1 }).limit(RECENT_PER_CAMPAIGN)),
      ),
      topDonors(),
      liveBanners(),
      Sponsor.find({ active: true }).sort({ order: 1 }),
      upcomingEvents(),
      Notification.find({ published: true }).sort({ createdAt: -1 }).limit(20),
      placeList(),
      Settings.findById('org'),
      Gallery.find({ published: true }).sort({ order: 1 }),
      Report.find({ published: true }).sort({ year: -1, createdAt: -1 }),
      TrusteeRole.find().sort({ order: 1 }),
      Trustee.find({ active: true }).sort({ order: 1, createdAt: 1 }),
      QuickLink.find({ active: true }).sort({ order: 1 }),
    ]);

    res.json({
      campaigns: campaigns.map(campaignView),
      recent: Object.fromEntries(campaigns.map((c, i) => [c.key, recentLists[i].map(donationView)])),
      topDonors: top,
      banners,
      sponsors,
      events,
      notifications,
      // Names of every place a donor can be from: villages, then talukas ("taluka:<key>") and districts ("district:<key>").
      villages: Object.fromEntries(villages.map((v) => [v.key, v.name])),
      // The line under each name in pickers (a village's taluka, a taluka's district), to tell same names apart.
      villageTalukas: Object.fromEntries(villages.filter((v) => v.sub).map((v) => [v.key, v.sub])),
      settings,
      gallery,
      reports,
      trusteeRoles,
      trustees,
      quickLinks,
    });
  }),
);

router.get(
  '/campaigns',
  ah(async (req, res) => {
    const campaigns = await Campaign.find({ active: true }).sort({ order: 1 });
    res.json(campaigns.map(campaignView));
  }),
);

const listQuery = z.object({
  campaign: z.string().optional(),
  type: z.enum(['all', 'money', 'material']).default('all'),
  village: z.string().optional(),
  q: z.string().max(60).optional(),
  before: z.string().datetime().optional(), // cursor: createdAt of the last item from the previous page
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get(
  '/donations',
  ah(async (req, res) => {
    const q = listQuery.parse(req.query);
    const filter = { ...visible };
    if (q.campaign) filter.campaign = q.campaign;
    if (q.village) filter.village = q.village;
    if (q.type === 'money') filter.material = null;
    if (q.type === 'material') filter.material = { $ne: null };
    if (q.before) filter.createdAt = { $lt: new Date(q.before) };
    if (q.q) {
      const re = new RegExp(escapeRe(q.q), 'i');
      filter.$or = [{ 'name.gu': re }, { 'name.en': re }, { village: { $in: await placeKeysMatching(re) } }];
    }
    const items = await Donation.find(filter).sort({ createdAt: -1 }).limit(q.limit);
    const last = items[items.length - 1];
    res.json({
      items: items.map(donationView),
      next: items.length === q.limit && last ? last.createdAt.toISOString() : null,
    });
  }),
);

const donationInput = z
  .object({
    campaign: z.string().min(1),
    amount: z.coerce.number().int().min(1).max(10_000_000).optional(),
    material: z.string().trim().min(1).max(120).optional(),
    name: z.string().trim().max(60).optional(),
    nameEn: z.string().trim().max(60).optional(),
    village: z.string().trim().toLowerCase().min(1).max(80),
    anon: z.boolean().default(false),
  })
  .refine((d) => d.amount || d.material, { message: 'amount or material is required' });

const donateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

router.post(
  '/donations',
  donateLimiter,
  loadUser,
  ah(async (req, res) => {
    const input = donationInput.parse(req.body);
    // A logged-in donor's pledge is linked to their account, so it shows in their history.
    const me = req.user?.id ? req.user : null;
    const { doc, ...result } = await recordDonation(me ? { ...input, phone: me.phone } : input, { userId: me?.id || null, actor: me });
    res.status(201).json(result);
  }),
);

router.get('/settings', ah(async (req, res) => res.json(await Settings.findById('org'))));

/** A donor's own donation status and receipt, authorised by the token returned when they pledged. */
router.get(
  '/donations/:id/receipt',
  ah(async (req, res) => {
    const doc = await Donation.findById(req.params.id).select('+receiptToken');
    const token = String(req.query.t || '');
    if (!doc || !doc.receiptToken || !safeEqual(token, doc.receiptToken)) throw new HttpError(404, 'Not found');
    res.json(await receiptData(doc));
  }),
);

/** The logged-in donor's own donations (linked account or same mobile number). */
router.get(
  '/me/donations',
  requireRole(),
  ah(async (req, res) => {
    const or = [{ phone: req.user.phone }];
    if (req.user.id) or.push({ userId: req.user.id });
    const items = await Donation.find({ $or: or }).sort({ createdAt: -1 }).limit(200);
    res.json(items.map(donationView));
  }),
);

router.get(
  '/me/donations/:id/receipt',
  requireRole(),
  ah(async (req, res) => {
    const doc = await Donation.findById(req.params.id).select('+phone');
    const mine = doc && (String(doc.userId) === String(req.user.id) || doc.phone === req.user.phone);
    if (!mine) throw new HttpError(404, 'Not found');
    res.json(await receiptData(doc));
  }),
);

router.get('/gallery', ah(async (req, res) => res.json(await Gallery.find({ published: true }).sort({ order: 1 }))));
router.get('/reports', ah(async (req, res) => res.json(await Report.find({ published: true }).sort({ year: -1 }))));

router.get(
  '/top-donors',
  ah(async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(50).catch(10).parse(req.query.limit);
    res.json(await topDonors(limit));
  }),
);
router.get('/events', ah(async (req, res) => res.json(await upcomingEvents())));
router.get(
  '/notifications',
  ah(async (req, res) => res.json(await Notification.find({ published: true }).sort({ createdAt: -1 }).limit(50))),
);
router.get('/sponsors', ah(async (req, res) => res.json(await Sponsor.find({ active: true }).sort({ order: 1 }))));
router.get(
  '/villages',
  ah(async (req, res) => {
    const villages = await placeList();
    res.json(Object.fromEntries(villages.map((v) => [v.key, v.name])));
  }),
);

router.get(
  '/trustees',
  ah(async (req, res) => {
    const [roles, trustees] = await Promise.all([TrusteeRole.find().sort({ order: 1 }), Trustee.find({ active: true }).sort({ order: 1, createdAt: 1 })]);
    res.json({ roles, trustees });
  }),
);

/* ---------------- Activities and mass wedding years ---------------- */

router.get(
  '/activities',
  ah(async (req, res) => {
    const { section } = z.object({ section: z.string().max(60) }).parse(req.query);
    res.json(await Activity.find({ section: section.toLowerCase(), published: true }).sort({ order: 1, date: -1, createdAt: -1 }));
  }),
);

const sum = (list, k) => list.reduce((n, x) => n + (x[k] || 0), 0);

/** Year list (newest first) with the totals shown on each card. */
router.get(
  '/weddings',
  ah(async (req, res) => {
    const years = await WeddingYear.find({ published: true }, { photos: 0, description: 0 }).sort({ order: 1, year: -1 });
    // Same totals as the year page: typed-in donors plus the linked campaign's received donations.
    const keys = [...new Set(years.map((y) => y.campaign).filter(Boolean))];
    const fromApp = keys.length
      ? await Donation.aggregate([
          { $match: { campaign: { $in: keys }, status: { $in: ['collected', 'approved'] } } },
          { $group: { _id: '$campaign', count: { $sum: 1 }, amount: { $sum: { $ifNull: ['$amount', 0] } } } },
        ])
      : [];
    const app = Object.fromEntries(fromApp.map((g) => [g._id, g]));
    res.json(
      years.map((y) => {
        const { donors, expenses, facts, ...rest } = y.toJSON();
        const extra = app[y.campaign] || { count: 0, amount: 0 };
        return { ...rest, donorCount: donors.length + extra.count, donorTotal: sum(donors, 'amount') + extra.amount, expenseTotal: sum(expenses, 'amount') };
      }),
    );
  }),
);

/** One year in full. With a linked campaign, its donations from the app come along (largest first). */
router.get(
  '/weddings/:id',
  ah(async (req, res) => {
    const doc = await WeddingYear.findOne({ _id: req.params.id, published: true });
    if (!doc) throw new HttpError(404, 'Not found');
    let campaign = null;
    let appDonors = [];
    if (doc.campaign) {
      const c = await Campaign.findOne({ key: doc.campaign });
      if (c) {
        campaign = campaignView(c);
        // Only money actually received: unverified app pledges stay off the official list.
        appDonors = (await Donation.find({ campaign: c.key, status: { $in: ['collected', 'approved'] } }).sort({ amount: -1, createdAt: 1 }).limit(1000)).map(donationView);
      }
    }
    res.json({ ...doc.toJSON(), campaignStats: campaign, appDonors });
  }),
);

/* ---------------- Members (family registrations) ---------------- */

/** Registered families, without contact details. */
router.get(
  '/members',
  ah(async (req, res) => {
    const q = memberListQuery.parse(req.query);
    const filter = await memberFilter(q);
    const [items, total] = await Promise.all([
      Member.find(filter).sort({ name: 1, _id: 1 }).skip(q.skip).limit(Math.min(q.limit, 100)),
      Member.countDocuments(filter),
    ]);
    res.json({ total, items: items.map(memberPublicView) });
  }),
);

router.get('/members/summary', ah(async (req, res) => res.json(await memberSummary())));

/**
 * The logged-in user's own family registration (null when not registered). A record the admin entered
 * with the same mobile number and no account yet is linked to this account.
 */
router.get(
  '/me/member',
  requireRole(),
  ah(async (req, res) => {
    const doc = await findOrLinkMember(req.user);
    res.json(doc ? memberView(doc) : null);
  }),
);

const memberLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });

router.put(
  '/me/member',
  memberLimiter,
  requireRole(),
  ah(async (req, res) => {
    if (!req.user.id) throw new HttpError(400, 'Log in with a mobile number to register');
    const input = memberInput.parse(req.body);
    await checkMemberVillage(input.village);
    const fields = { ...input, phone: input.phone || req.user.phone };
    const existing = await findOrLinkMember(req.user);
    let doc;
    if (existing) {
      doc = await Member.findByIdAndUpdate(existing._id, fields, { new: true, runValidators: true });
    } else {
      try {
        doc = await Member.create({ ...fields, userId: req.user.id, source: 'app' });
      } catch (err) {
        if (err?.code !== 11000) throw err;
        // Saved twice at once: update the record the other request created.
        doc = await Member.findOneAndUpdate({ userId: req.user.id }, fields, { new: true, runValidators: true });
      }
    }
    if (!req.user.name) await User.updateOne({ _id: req.user.id }, { name: input.name.slice(0, 60) });
    await logActivity({ actor: req.user, action: existing ? 'update' : 'create', entity: 'members', entityId: doc._id, label: doc.name, note: 'From the app' });
    res.json(memberView(doc));
  }),
);

router.delete(
  '/me/member',
  requireRole(),
  ah(async (req, res) => {
    const doc = req.user.id && (await Member.findOneAndDelete({ userId: req.user.id }));
    if (doc) await logActivity({ actor: req.user, action: 'delete', entity: 'members', entityId: doc._id, label: doc.name, note: 'Cancelled in the app', snapshot: doc });
    res.status(204).end();
  }),
);

/** Live feed (Server-Sent Events): `donation`, `stats`, `status` and `refresh` events. */
router.get('/live', subscribe);

export default router;
