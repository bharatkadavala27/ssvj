import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Donation, Member, Otp, User } from '../models/index.js';
import { coveredPlaces, placesByKeys } from '../lib/places.js';
import { HttpError, ah } from '../middleware/errors.js';
import { requireRole } from '../middleware/auth.js';
import { hashOtp, issueToken, newOtpCode, normalizePhone, safeEqual } from '../lib/auth.js';
import { sendOtp } from '../lib/sms.js';
import { env } from '../config/env.js';
import { logActivity } from '../lib/activity.js';

/** Mobile + OTP login for everyone (public, sevak, admin). Mounted at /api/auth. */
const router = Router();

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

const ipLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

/** Play Store reviewers' fixed login (REVIEW_LOGIN="9999911111:246810"): no SMS, the code never changes. */
const review = (() => {
  const [phone, code] = env.reviewLogin.split(':').map((s) => s.trim());
  return normalizePhone(phone) && /^\d{6}$/.test(code || '') ? { phone: normalizePhone(phone), code } : null;
})();

const phoneField = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number' });
  return p;
});

/**
 * Remembers which app version a user runs (?v=1.2.0&p=android on /me, or in the login body). Written only
 * when it changed or at most once an hour, so opening the app stays cheap.
 */
async function noteApp(user, v, p) {
  if (!user?._id || !/^[0-9A-Za-z.-]{1,20}$/.test(v || '')) return;
  const platform = ['android', 'ios', 'web'].includes(p) ? p : null;
  const stale = !user.lastSeenAt || Date.now() - new Date(user.lastSeenAt).getTime() > 3600 * 1000;
  if (user.appVersion !== v || user.appPlatform !== platform || stale) {
    await User.updateOne({ _id: user._id }, { appVersion: v, appPlatform: platform, lastSeenAt: new Date() });
  }
}

/** What the app needs to pick the interface. Role comes from the database, never from the client. */
export async function sessionUser(u) {
  const assigned = u.villages || [];
  const villages = await placesByKeys(assigned);
  // A sevak assigned a taluka or district may record donations for every place inside it.
  const wide = assigned.some((k) => k.includes(':'));
  const places = wide ? await placesByKeys([...(await coveredPlaces(assigned))]) : villages;
  return { id: String(u._id || u.id), name: u.name, phone: u.phone, role: u.role, villages, places };
}

router.post(
  '/otp',
  ipLimiter,
  ah(async (req, res) => {
    const { phone } = z.object({ phone: phoneField }).parse(req.body);
    if (review && phone === review.phone) return res.json({ sent: true });
    const last = await Otp.findOne({ phone }).sort({ createdAt: -1 });
    if (last && Date.now() - last.createdAt.getTime() < RESEND_MS) {
      throw new HttpError(429, 'Please wait a few seconds before requesting another code');
    }
    const sentLastHour = await Otp.countDocuments({ phone, createdAt: { $gt: new Date(Date.now() - 3600 * 1000) } });
    if (sentLastHour >= 5) throw new HttpError(429, 'Too many codes requested. Try again later.');

    const code = newOtpCode();
    await Otp.create({ phone, codeHash: hashOtp(phone, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) });
    await sendOtp(phone, code);
    // With the console provider (no SMS set up), return the code so the app can be tested without SMS:
    // always in development, and in production only while SHOW_OTP=true (testing phase). Once a real
    // SMS provider is set, codes are never returned.
    const showCode = env.sms.provider === 'console' && (!env.isProd || env.showOtp);
    res.json({ sent: true, ...(showCode && { devCode: code }) });
  }),
);

router.post(
  '/verify',
  ipLimiter,
  ah(async (req, res) => {
    const { phone, code, name, v, p } = z
      .object({
        phone: phoneField,
        code: z.string().regex(/^\d{6}$/),
        name: z.string().trim().max(60).optional(),
        v: z.string().max(20).optional(),
        p: z.string().max(10).optional(),
      })
      .parse(req.body);
    if (review && phone === review.phone) {
      if (!safeEqual(code, review.code)) throw new HttpError(400, 'Wrong code');
    } else {
      const latest = await Otp.findOne({ phone, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
      // Count the attempt before comparing, atomically, so parallel guesses can't exceed the limit.
      const otp = latest && (await Otp.findOneAndUpdate({ _id: latest._id, attempts: { $lt: MAX_ATTEMPTS } }, { $inc: { attempts: 1 } }, { new: true }));
      if (!otp) throw new HttpError(400, 'Code expired. Request a new one.');
      if (!safeEqual(otp.codeHash, hashOtp(phone, code))) throw new HttpError(400, 'Wrong code');
      await Otp.deleteMany({ phone });
    }

    // First login creates a public account; sevak/admin roles are only ever set by an admin.
    let user = await User.findOne({ phone });
    if (!user) user = await User.create({ phone, name: name || '', role: 'public' });
    if (!user.active) throw new HttpError(403, 'This account is disabled');
    if (name && !user.name) user.name = name;
    user.lastLoginAt = new Date();
    await user.save();
    await noteApp(user, v, p);

    res.json({ token: issueToken(user), user: await sessionUser(user) });
  }),
);

router.get(
  '/me',
  requireRole(),
  ah(async (req, res) => {
    const user = req.user.id ? await User.findById(req.user.id) : null;
    if (user) await noteApp(user, req.query.v, req.query.p);
    res.json(await sessionUser(user || req.user));
  }),
);

router.patch(
  '/me',
  requireRole(),
  ah(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
    if (!req.user.id) throw new HttpError(400, 'Log in with a mobile number to change the name');
    const user = await User.findByIdAndUpdate(req.user.id, { name }, { new: true });
    res.json(await sessionUser(user));
  }),
);

/**
 * Deletes the caller's own account (a Play Store requirement): the login and their family registration are
 * removed; donation receipts stay as the trust's accounts, no longer linked to the account. The last admin
 * cannot delete themselves.
 */
router.delete(
  '/me',
  requireRole(),
  ah(async (req, res) => {
    if (!req.user.id) throw new HttpError(400, 'Not a user account');
    const user = await User.findById(req.user.id);
    if (!user) return res.status(204).end();
    if (user.role === 'admin' && !(await User.exists({ _id: { $ne: user._id }, role: 'admin', active: true }))) {
      throw new HttpError(409, 'You are the only admin. Make someone else an admin first.');
    }
    const member = await Member.findOne({ userId: user._id });
    if (member) await Member.deleteOne({ _id: member._id });
    await Donation.updateMany({ userId: user._id }, { $set: { userId: null } });
    await Otp.deleteMany({ phone: user.phone });
    await User.deleteOne({ _id: user._id });
    // The log keeps no copy of the deleted data: only that it happened, with a masked number.
    const masked = `${user.name || 'User'} ••••${user.phone.slice(-4)}`;
    await logActivity({
      actor: { id: user._id, name: masked, role: user.role },
      action: 'delete',
      entity: 'users',
      entityId: user._id,
      label: masked,
      note: member ? 'Deleted their own account in the app, with their family registration' : 'Deleted their own account in the app',
    });
    res.status(204).end();
  }),
);

export default router;
