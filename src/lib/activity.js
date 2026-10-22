import { ActivityLog } from '../models/index.js';

const plain = (v) => (v && typeof v.toObject === 'function' ? v.toObject() : v);

/** Keeps log entries small: long lists and texts are summarised. */
export function brief(v) {
  v = plain(v);
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.length > 5 ? `[${v.length} items]` : v;
  if (typeof v === 'string' && v.length > 300) return v.slice(0, 300) + '…';
  if (v && typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 600 ? s.slice(0, 600) + '…' : v;
  }
  return v;
}

const same = (a, b) => JSON.stringify(plain(a) ?? null) === JSON.stringify(plain(b) ?? null);

/** Field-level differences between two plain objects, for the given keys (default: keys of `after`). */
export function diff(before = {}, after = {}, keys = Object.keys(after)) {
  return keys
    .filter((k) => !['_id', 'id', '__v', 'createdAt', 'updatedAt'].includes(k))
    .filter((k) => !same(before?.[k], after?.[k]))
    .map((field) => ({ field, from: brief(before?.[field]), to: brief(after?.[field]) }));
}

const actorOf = (u) => (u ? { id: u.id || null, name: u.name || (u.id ? null : 'Admin key'), phone: u.phone || null, role: u.role || null } : null);

/** Writes one log entry. Never throws: a failed log must not undo the change it describes. */
export async function logActivity({ actor, action, entity, entityId, label, changes, note, snapshot }) {
  try {
    await ActivityLog.create({
      actor: actorOf(actor),
      action,
      entity,
      entityId: entityId ? String(entityId) : null,
      label: label || null,
      changes: changes || [],
      note: note || null,
      snapshot: snapshot ? plain(snapshot) : null,
    });
  } catch (err) {
    console.error('[activity] could not log', action, entity, err.message);
  }
}

/** A short name for a record in the log (name, label, title, year or key). */
export function labelOf(doc) {
  const d = plain(doc) || {};
  return d.name?.gu || (typeof d.name === 'string' && d.name) || d.label?.gu || d.title?.gu || d.caption?.gu || d.year || d.key || (d._id && String(d._id)) || null;
}
