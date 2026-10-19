import mongoose from 'mongoose';
import { Localized, jsonOptions } from './shared.js';

const { Schema, model } = mongoose;

export const ROLES = ['public', 'sevak', 'admin'];
/** pledged: promised in the app · collected: cash taken by a sevak (receipt issued) · approved: verified by admin · rejected */
export const STATUSES = ['pledged', 'collected', 'approved', 'rejected'];

/** Gujarat districts (જિલ્લા) and talukas (તાલુકા): reference lists villages are linked to. */
const DistrictSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: Localized, required: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: jsonOptions },
);

const TalukaSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: Localized, required: true },
    district: { type: String, required: true, lowercase: true, index: true }, // District key
    order: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: jsonOptions },
);

const VillageSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: Localized, required: true },
    talukaKey: { type: String, default: null, lowercase: true, index: true },
    // Copies of the linked taluka/district names (printed on receipts); kept in sync by the admin routes.
    taluka: { type: Localized, default: null },
    district: { type: Localized, default: null },
    order: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: jsonOptions },
);

const CampaignSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    label: { type: Localized, required: true },
    target: { type: Number, required: true, min: 0 },
    // Running totals. Seeded with historical figures and updated as donations are recorded or rejected.
    collected: { type: Number, default: 0, min: 0 },
    donors: { type: Number, default: 0, min: 0 },
    villages: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    // Thank-you poster heading for this campaign (e.g. "29મો સમૂહ લગ્નોત્સવ"), with optional date and venue.
    poster: {
      title: { type: Localized, default: null },
      date: { type: Date, default: null },
      venue: { type: Localized, default: null },
    },
  },
  { timestamps: true, toJSON: jsonOptions },
);

const StaffRef = new Schema(
  {
    id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, default: null },
    phone: { type: String, default: null },
  },
  { _id: false },
);

const DonationSchema = new Schema(
  {
    campaign: { type: String, required: true, lowercase: true, index: true },
    name: { type: Localized, required: true },
    initial: { type: Localized, required: true },
    photo: { type: String, default: null }, // bundled avatar key or uploaded image URL
    village: { type: String, required: true, lowercase: true },
    amount: { type: Number, default: null, min: 0 }, // null for in-kind donations
    material: { type: Localized, default: null }, // in-kind description
    anon: { type: Boolean, default: false },
    phone: { type: String, default: null, select: false }, // donor's mobile: staff only
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true }, // donor's account, if logged in
    status: { type: String, enum: STATUSES, default: 'pledged', index: true },
    source: { type: String, enum: ['app', 'sevak', 'admin', 'seed'], default: 'app' },

    // Receipt (પહોંચ) fields, mirroring the paper slip
    receiptNo: { type: Number, default: null },
    receiptToken: { type: String, default: null, select: false }, // lets a logged-out donor fetch their receipt
    details: { type: String, default: null, trim: true }, // વિગત
    through: { type: String, default: null, trim: true }, // હ. (on behalf of / through)
    business: { type: String, default: null, trim: true }, // firm shown on the poster
    currentPlace: { type: String, default: null, trim: true }, // હાલ (where the donor lives now)
    collectedBy: { type: StaffRef, default: null },
    collectedAt: { type: Date, default: null },
    approvedBy: { type: StaffRef, default: null },
    approvedAt: { type: Date, default: null },
    rejectReason: { type: String, default: null },
  },
  { timestamps: true, toJSON: jsonOptions },
);
DonationSchema.index({ campaign: 1, createdAt: -1 });
DonationSchema.index({ village: 1 });
DonationSchema.index({ 'collectedBy.id': 1, createdAt: -1 });
DonationSchema.index({ receiptNo: 1 }, { unique: true, partialFilterExpression: { receiptNo: { $type: 'number' } } });

const EventSchema = new Schema(
  {
    title: { type: Localized, required: true },
    place: { type: Localized, required: true },
    date: { type: Date, required: true, index: true },
    photo: { type: String, default: null },
    published: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

const NotificationSchema = new Schema(
  {
    title: { type: Localized, required: true },
    body: { type: Localized, required: true },
    published: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

const SponsorSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true }, // matches a logo in the app
    name: { type: Localized, required: true },
    logo: { type: String, default: null }, // uploaded logo URL (overrides the built-in mark)
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    // Details shown when the sponsor is tapped in the app
    photo: { type: String, default: null }, // cover photo (shop, products…)
    about: { type: Localized, default: null },
    owner: { type: Localized, default: null },
    phone: { type: String, default: null, trim: true },
    whatsapp: { type: String, default: null, trim: true },
    email: { type: String, default: null, trim: true },
    address: { type: Localized, default: null },
    mapUrl: { type: String, default: null, trim: true }, // empty: a map search for the address
    website: { type: String, default: null, trim: true },
    facebook: { type: String, default: null, trim: true },
    instagram: { type: String, default: null, trim: true },
    youtube: { type: String, default: null, trim: true },
    buttonText: { type: Localized, default: null }, // optional extra button, e.g. "ઓફર જુઓ / See offers"
    buttonLink: { type: String, default: null, trim: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

export const BANNER_TYPES = ['donor', 'image'];

/** Home slider slide: a donor thank-you, or a plain image (poster, announcement) with optional text and link. */
const BannerSchema = new Schema(
  {
    type: { type: String, enum: BANNER_TYPES, default: 'donor' },
    // Set when this slide customises an automatic top-donor slide (photo, name, background…); the app
    // keeps it at that donor's rank with the live total. Matches topDonors()'s id ("village:name").
    topDonorId: { type: String, default: null, index: true },
    photo: { type: String, required: true },
    // Donor slides (required fields are checked per type in the admin route)
    donor: {
      name: { type: Localized, default: null },
      initial: { type: Localized, default: null },
      photo: { type: String, default: null },
      village: { type: String, default: null },
      amount: { type: Number, default: null, min: 0 },
    },
    cause: { type: Localized, default: null },
    // Image slides
    title: { type: Localized, default: null },
    subtitle: { type: Localized, default: null },
    link: { type: String, default: null, trim: true }, // opened by the button, or by tapping the slide when there is none
    buttonText: { type: Localized, default: null }, // e.g. sponsors: "દુકાનની મુલાકાત લો / Visit shop"
    // Schedule: shown only between startAt and endAt (either may be empty)
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

const GallerySchema = new Schema(
  {
    photo: { type: String, required: true }, // bundled key or uploaded URL
    caption: { type: Localized, required: true },
    order: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

const ReportSchema = new Schema(
  {
    title: { type: Localized, required: true },
    year: { type: String, required: true, trim: true }, // e.g. "2025-26"
    url: { type: String, required: true },
    publicId: { type: String, default: null },
    published: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

const ContactSchema = new Schema(
  {
    name: { type: Localized, required: true },
    role: { type: Localized, required: true },
    phone: { type: String, required: true },
  },
  { _id: false },
);

/** Single document (_id "org") with organisation details used on receipts and posters. */
const SettingsSchema = new Schema(
  {
    _id: { type: String, default: 'org' },
    name: { type: Localized, required: true },
    shortName: { type: Localized, required: true },
    regNo: { type: Localized, required: true },
    logo: { type: String, default: null }, // uploaded logo URL; the app's bundled logo is used when empty
    blessings: { type: [Localized], default: [] }, // header lines like "|| જય ભગીરથ ||"
    contacts: { type: [ContactSchema], default: [] },
    receiptFooter: { type: Localized, default: null },
    // Optional photos in the thank-you poster's top corners (e.g. ભગીરથ દાદા, દાસારામ બાપા)
    posterImages: {
      left: { type: String, default: null },
      right: { type: String, default: null },
    },
    // Home screen slider behaviour
    slider: {
      enabled: { type: Boolean, default: true },
      autoplay: { type: Boolean, default: true },
      interval: { type: Number, default: 4.5, min: 2, max: 30 }, // seconds per slide
      loop: { type: Boolean, default: true },
      // Automatic thank-you slides for the top donors, shown after the admin's own slides
      topDonors: { type: Boolean, default: true },
      topDonorCount: { type: Number, default: 10, min: 1, max: 10 },
    },
  },
  { timestamps: true, toJSON: { versionKey: false } },
);

/** Atomic sequences (receipt numbers). */
const CounterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });

/** Everyone who has logged in. The role is assigned by an admin and enforced on every request. */
const UserSchema = new Schema(
  {
    name: { type: String, default: '', trim: true },
    phone: { type: String, required: true, unique: true, trim: true }, // 10-digit Indian mobile
    role: { type: String, enum: ROLES, default: 'public', index: true },
    villages: { type: [String], default: [] }, // sevak's assigned village keys
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: jsonOptions },
);

/** One-time login codes; MongoDB deletes them after expiry (TTL index). */
const OtpSchema = new Schema(
  {
    phone: { type: String, required: true, index: true },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const District = model('District', DistrictSchema);
export const Taluka = model('Taluka', TalukaSchema);
export const Village = model('Village', VillageSchema);
export const Campaign = model('Campaign', CampaignSchema);
export const Donation = model('Donation', DonationSchema);
export const Event = model('Event', EventSchema);
export const Notification = model('Notification', NotificationSchema);
export const Sponsor = model('Sponsor', SponsorSchema);
export const Banner = model('Banner', BannerSchema);
export const Gallery = model('Gallery', GallerySchema);
export const Report = model('Report', ReportSchema);
export const Settings = model('Settings', SettingsSchema);
export const Counter = model('Counter', CounterSchema);
export const User = model('User', UserSchema);
export const Otp = model('Otp', OtpSchema);
