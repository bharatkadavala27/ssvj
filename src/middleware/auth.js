import { env } from '../config/env.js';
import { readToken, safeEqual } from '../lib/auth.js';
import { User } from '../models/index.js';

const SCRIPT_ADMIN = { id: null, name: 'Admin', phone: null, role: 'admin', villages: [] };

/**
 * Resolves the caller from `Authorization: Bearer <token>` (or the server ADMIN_KEY in `x-admin-key`,
 * for scripts) and sets req.user. The role is read from the database on every request, so changing
 * anything on the phone cannot grant access.
 */
export async function loadUser(req, res, next) {
  try {
    req.user = null;
    if (env.adminKey && req.get('x-admin-key') && safeEqual(req.get('x-admin-key'), env.adminKey)) {
      req.user = SCRIPT_ADMIN;
      return next();
    }
    const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const session = bearer && readToken(bearer);
    if (session) {
      const user = await User.findById(session.sub);
      if (user?.active) {
        req.user = { id: user._id, name: user.name, phone: user.phone, role: user.role, villages: user.villages };
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Requires a logged-in user, optionally with one of `roles`. */
export function requireRole(...roles) {
  return [
    loadUser,
    (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'Login required' });
      if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed for your role' });
      next();
    },
  ];
}

export const adminAuth = requireRole('admin');
