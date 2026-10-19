import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Banner, Campaign, Donation, Event, Gallery, Notification, Report, Settings, Sponsor, Village } from '../models/index.js';
import { HttpError, ah } from '../middleware/errors.js';
import { loadUser, requireRole } from '../middleware/auth.js';
import { safeEqual } from '../lib/auth.js';
import { campaignStats, donationView, receiptData, recordDonation, topDonors } from '../lib/donations.js';
import { eventView } from '../lib/format.js';
import { subscribe } from '../lib/live.js';
import { cloudinaryReady } from '../lib/cloudinary.js';

const router = Router();
const visible = { status: { $ne: 'rejected' } };
const RECENT_PER_CAMPAIGN = 20;

const campaignView = (c) => ({ ...campaignStats(c), label: c.label, poster: c.poster });

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
    const [recentLists, top, banners, sponsors, events, notifications, villages, settings, gallery, reports] = await Promise.all([
      Promise.all(
        campaigns.map((c) => Donation.find({ ...visible, campaign: c.key }).sort({ createdAt: -1 }).limit(RECENT_PER_CAMPAIGN)),
      ),
      topDonors(),
      liveBanners(),
      Sponsor.find({ active: true }).sort({ order: 1 }),
      upcomingEvents(),
      Notification.find({ published: true }).sort({ createdAt: -1 }).limit(20),
      Village.find().sort({ order: 1 }),
      Settings.findById('org'),
      Gallery.find({ published: true }).sort({ order: 1 }),
      Report.find({ published: true }).sort({ year: -1, createdAt: -1 }),
    ]);

    res.json({
      campaigns: campaigns.map(campaignView),
      recent: Object.fromEntries(campaigns.map((c, i) => [c.key, recentLists[i].map(donationView)])),
      topDonors: top,
      banners,
      sponsors,
      events,
      notifications,
      villages: Object.fromEntries(villages.map((v) => [v.key, v.name])),
      // Taluka per village, so pickers can tell same-named villages apart and search by taluka.
      villageTalukas: Object.fromEntries(villages.filter((v) => v.taluka).map((v) => [v.key, v.taluka])),
      settings,
      gallery,
      reports,
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
      const villageKeys = (await Village.find({ $or: [{ 'name.gu': re }, { 'name.en': re }] })).map((v) => v.key);
      filter.$or = [{ 'name.gu': re }, { 'name.en': re }, { village: { $in: villageKeys } }];
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
    village: z.string().min(1).max(40),
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
    const { doc, ...result } = await recordDonation(me ? { ...input, phone: me.phone } : input, { userId: me?.id || null });
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

router.get('/top-donors', ah(async (req, res) => res.json(await topDonors(Math.min(Number(req.query.limit) || 10, 50)))));
router.get('/events', ah(async (req, res) => res.json(await upcomingEvents())));
router.get(
  '/notifications',
  ah(async (req, res) => res.json(await Notification.find({ published: true }).sort({ createdAt: -1 }).limit(50))),
);
router.get('/sponsors', ah(async (req, res) => res.json(await Sponsor.find({ active: true }).sort({ order: 1 }))));
router.get(
  '/villages',
  ah(async (req, res) => {
    const villages = await Village.find().sort({ order: 1 });
    res.json(Object.fromEntries(villages.map((v) => [v.key, v.name])));
  }),
);

/** Live feed (Server-Sent Events): `donation`, `stats`, `status` and `refresh` events. */
router.get('/live', subscribe);

export default router;
