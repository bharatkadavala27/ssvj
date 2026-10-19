import mongoose from 'mongoose';

/** A Gujarati/English text pair, matching the frontend's `{ gu, en }` shape. */
export const Localized = new mongoose.Schema(
  {
    gu: { type: String, required: true, trim: true },
    en: { type: String, trim: true },
  },
  { _id: false },
);

/** toJSON transform: expose `id` instead of `_id`/`__v`. */
export const jsonOptions = {
  virtuals: false,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
  },
};
