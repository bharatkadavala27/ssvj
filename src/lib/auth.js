import crypto from 'node:crypto';
import { env } from '../config/env.js';

const SESSION_DAYS = 60;

/** Normalises an Indian mobile number to 10 digits ("+91 98765-43210" -> "9876543210"); null if invalid. */
export function normalizePhone(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

const hmac = (data) => crypto.createHmac('sha256', env.sessionSecret).update(data).digest('base64url');

export const newOtpCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
export const hashOtp = (phone, code) => hmac(`otp:${phone}:${code}`);

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Stateless session token: base64url(JSON payload) + "." + HMAC.
 * It carries only the user id; the role is always re-read from the database.
 */
export function issueToken(user) {
  const payload = { sub: String(user._id), exp: Date.now() + SESSION_DAYS * 86400000 };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${hmac(data)}`;
}

export function readToken(token) {
  const [data, sig] = String(token || '').split('.');
  if (!data || !sig || !safeEqual(sig, hmac(data))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export const newReceiptToken = () => crypto.randomBytes(12).toString('base64url');
