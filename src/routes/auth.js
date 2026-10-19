import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Otp, User, Village } from '../models/index.js';
import { HttpError, ah } from '../middleware/errors.js';
import { requireRole } from '../middleware/auth.js';
import { hashOtp, issueToken, newOtpCode, normalizePhone, safeEqual } from '../lib/auth.js';
import { sendOtp } from '../lib/sms.js';
import { env } from '../config/env.js';

/** Mobile + OTP login for everyone (public, sevak, admin). Mounted at /api/auth. */
const router = Router();

const OTP_TTL_MS = 5 * 60 * 1000;
const RESEND_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

const ipLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

const phoneField = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number' });
  return p;
});

/** What the app needs to pick the interface. Role comes from the database, never from the client. */
export async function sessionUser(u) {
  const villages = u.villages?.length ? await Village.find({ key: { $in: u.villages } }).sort({ order: 1 }) : [];
  return { id: String(u._id || u.id), name: u.name, phone: u.phone, role: u.role, villages };
}

router.post(
  '/otp',
  ipLimiter,
  ah(async (req, res) => {
    const { phone } = z.object({ phone: phoneField }).parse(req.body);
    const last = await Otp.findOne({ phone }).sort({ createdAt: -1 });
    if (last && Date.now() - last.createdAt.getTime() < RESEND_MS) {
      throw new HttpError(429, 'Please wait a few seconds before requesting another code');
    }
    const sentLastHour = await Otp.countDocuments({ phone, createdAt: { $gt: new Date(Date.now() - 3600 * 1000) } });
    if (sentLastHour >= 5) throw new HttpError(429, 'Too many codes requested. Try again later.');

    const code = newOtpCode();
    await Otp.create({ phone, codeHash: hashOtp(phone, code), expiresAt: new Date(Date.now() + OTP_TTL_MS) });
    await sendOtp(phone, code);
    // In development with the console provider, return the code so the app can be tested without SMS.
    res.json({ sent: true, ...(env.sms.provider === 'console' && !env.isProd && { devCode: code }) });
  }),
);

router.post(
  '/verify',
  ipLimiter,
  ah(async (req, res) => {
    const { phone, code, name } = z
      .object({ phone: phoneField, code: z.string().regex(/^\d{6}$/), name: z.string().trim().max(60).optional() })
      .parse(req.body);
    const otp = await Otp.findOne({ phone, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
    if (!otp || otp.attempts >= MAX_ATTEMPTS) throw new HttpError(400, 'Code expired. Request a new one.');
    if (!safeEqual(otp.codeHash, hashOtp(phone, code))) {
      await Otp.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
      throw new HttpError(400, 'Wrong code');
    }
    await Otp.deleteMany({ phone });

    // First login creates a public account; sevak/admin roles are only ever set by an admin.
    let user = await User.findOne({ phone });
    if (!user) user = await User.create({ phone, name: name || '', role: 'public' });
    if (!user.active) throw new HttpError(403, 'This account is disabled');
    if (name && !user.name) user.name = name;
    user.lastLoginAt = new Date();
    await user.save();

    res.json({ token: issueToken(user), user: await sessionUser(user) });
  }),
);

router.get(
  '/me',
  requireRole(),
  ah(async (req, res) => res.json(await sessionUser(req.user.id ? await User.findById(req.user.id) : req.user))),
);

router.patch(
  '/me',
  requireRole(),
  ah(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
    const user = await User.findByIdAndUpdate(req.user.id, { name }, { new: true });
    res.json(await sessionUser(user));
  }),
);

export default router;
