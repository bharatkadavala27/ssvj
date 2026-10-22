import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Donation } from '../models/index.js';
import { coveredPlaces, placeList, placesByKeys } from '../lib/places.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError, ah } from '../middleware/errors.js';
import { donationStaffView, receiptData, recordDonation, transitionDonation } from '../lib/donations.js';
import { normalizePhone } from '../lib/auth.js';

/** Sevak (collector) features. Admins may use them too. Mounted at /api/sevak. */
const router = Router();
router.use(requireRole('sevak', 'admin'));

const isAdmin = (req) => req.user.role === 'admin';

/** Places (villages, talukas, districts) this caller may record donations for (admins: all). */
async function allowedVillages(req) {
  return isAdmin(req) ? placeList() : placesByKeys([...(await coveredPlaces(req.user.villages || []))]);
}

/** An assigned taluka or district covers the places inside it. */
async function assertVillage(req, village) {
  if (isAdmin(req)) return;
  const covered = await coveredPlaces(req.user.villages || []);
  if (!covered.has(String(village).toLowerCase())) throw new HttpError(403, 'This village is not assigned to you');
}

router.get('/villages', ah(async (req, res) => res.json(await allowedVillages(req))));

/** Receipt payload for staff: includes the donor's phone so the slip can be sent to their WhatsApp. */
async function staffReceipt(doc) {
  const full = doc.phone === undefined ? await Donation.findById(doc._id).select('+phone') : doc;
  return { ...(await receiptData(full)), donation: donationStaffView(full) };
}

const optText = (max) => z.string().trim().max(max).optional().transform((v) => v || undefined);

/** Record cash collected in person: the digital receipt slip. */
router.post(
  '/donations',
  ah(async (req, res) => {
    const input = z
      .object({
        campaign: z.string(),
        village: z.string().trim().toLowerCase().min(1).max(80),
        amount: z.coerce.number().int().min(1).max(100_000_000).optional(),
        material: optText(120),
        name: optText(80),
        nameEn: optText(80),
        anon: z.boolean().default(false),
        phone: z
          .string()
          .optional()
          .transform((v, ctx) => {
            if (!v) return undefined;
            const p = normalizePhone(v);
            if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid mobile number' });
            return p;
          }),
        details: optText(200),
        through: optText(80),
        business: optText(120),
        currentPlace: optText(60),
      })
      .refine((d) => d.amount || d.material, { message: 'amount or material is required' })
      .parse(req.body);
    await assertVillage(req, input.village);
    const { doc } = await recordDonation(input, {
      source: isAdmin(req) ? 'admin' : 'sevak',
      status: isAdmin(req) ? 'approved' : 'collected',
      actor: req.user,
    });
    res.status(201).json(await staffReceipt(doc));
  }),
);

/** The caller's collection history, newest first, with a summary by status. */
router.get(
  '/donations',
  ah(async (req, res) => {
    const q = z
      .object({ status: z.enum(['collected', 'approved', 'rejected']).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) })
      .parse(req.query);
    const mine = req.user.id ? { 'collectedBy.id': new mongoose.Types.ObjectId(String(req.user.id)) } : { source: 'admin' };
    const filter = { ...mine, ...(q.status && { status: q.status }) };
    const [items, summary] = await Promise.all([
      Donation.find(filter).select('+phone').sort({ createdAt: -1 }).limit(q.limit),
      Donation.aggregate([
        { $match: mine },
        { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: { $ifNull: ['$amount', 0] } } } },
      ]),
    ]);
    res.json({
      items: items.map(donationStaffView),
      summary: Object.fromEntries(summary.map((s) => [s._id, { count: s.count, amount: s.amount }])),
    });
  }),
);

/** App pledges from the caller's villages that still await payment. */
router.get(
  '/pending',
  ah(async (req, res) => {
    const filter = isAdmin(req) ? { status: 'pledged' } : { status: 'pledged', village: { $in: [...(await coveredPlaces(req.user.villages || []))] } };
    const items = await Donation.find(filter)
      .select('+phone')
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(items.map(donationStaffView));
  }),
);

/** Cash received for an app pledge: issues the receipt. */
router.post(
  '/donations/:id/collect',
  ah(async (req, res) => {
    const existing = await Donation.findById(req.params.id);
    if (!existing) throw new HttpError(404, 'Not found');
    await assertVillage(req, existing.village);
    // Only an app pledge can be collected here; a rejected donation is restored only by an admin.
    if (existing.status !== 'pledged') {
      if (existing.status === 'collected' || existing.status === 'approved') return res.json(await staffReceipt(existing));
      throw new HttpError(409, 'This donation was rejected; only an admin can restore it');
    }
    const doc = await transitionDonation(req.params.id, isAdmin(req) ? 'approved' : 'collected', req.user);
    res.json(await staffReceipt(doc));
  }),
);

router.get(
  '/receipts/:id',
  ah(async (req, res) => {
    const doc = await Donation.findById(req.params.id).select('+phone');
    if (!doc) throw new HttpError(404, 'Not found');
    const own = req.user.id && String(doc.collectedBy?.id) === String(req.user.id);
    if (!isAdmin(req) && !own) throw new HttpError(403, 'Not your receipt');
    res.json(await staffReceipt(doc));
  }),
);

export default router;
