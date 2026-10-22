import { ZodError } from 'zod';
import mongoose from 'mongoose';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Wraps async route handlers so rejections reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    const { formErrors, fieldErrors } = err.flatten();
    const cap = (list) => [...new Set(list)].slice(0, 5);
    const fields = Object.fromEntries(Object.entries(fieldErrors).slice(0, 20).map(([k, v]) => [k, cap(v)]));
    return res.status(400).json({ error: 'Invalid request', details: { ...fields, ...(formErrors.length && { _: cap(formErrors) }) } });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: 'Invalid data', details: Object.keys(err.errors) });
  }
  if (err instanceof mongoose.Error.VersionError) {
    return res.status(409).json({ error: 'This record was changed by someone else at the same time. Reload and try again.' });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: `Invalid ${err.path}` });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ error: 'Already exists', details: err.keyValue });
  }
  // body-parser: too large (413) or malformed JSON (400)
  if (err?.expose && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.type === 'entity.too.large' ? 'Request too large' : 'Invalid request body' });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
}
