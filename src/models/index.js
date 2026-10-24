import mongoose from 'mongoose';
import { Localized, jsonOptions } from './shared.js';

const { Schema, model } = mongoose;

export const ROLES = ['public', 'sevak', 'admin'];
/** pledged: promised in the app · collected: cash taken by a sevak (receipt issued) · approved: verified by admin · rejected */
export const STATUSES = ['pledged', 'collected', 'approved', 'rejected'];
/** How the money came in, chosen when the receipt is issued. */
export const PAY_MODES = ['cash', 'upi', 'cheque', 'bank'];

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

/** Built-in progress icons for the live-donation card; drawn in the app (frontend/src/components/CampaignGauge.jsx). */
export const GAUGE_ICONS = ['temple', 'rings', 'house', 'heart', 'book'];

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
    // The live-donation card counts down to this day ("N days to go"), e.g. the wedding day.
    countdownTo: { type: Date, default: null },
    // Progress icon on the live-donation card: an uploaded image (any format) replaces the built-in icon.
    // style "photo" turns the image from grey to full colour as the total grows; "shape" fills a transparent
    // PNG/SVG's silhouette with the theme colour, like the built-in icons.
    gauge: {
      icon: { type: String, enum: GAUGE_ICONS, default: 'temple' },
      image: { type: String, default: null },
      style: { type: String, enum: ['photo', 'shape'], default: 'photo' },
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
    village: { type: String, required: true, lowercase: true, trim: true },
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
    // Payment, recorded with the receipt; null for in-kind gifts and older records.
    payMode: { type: String, enum: [...PAY_MODES, null], default: null },
    payRef: { type: String, default: null, trim: true }, // UPI transaction id, cheque or bank reference
    // A promise a sevak wrote down ("I'll pay next month"): who took it and the day the donor said they would pay.
    pledgedBy: { type: StaffRef, default: null },
    dueDate: { type: Date, default: null },
  },
  { timestamps: true, toJSON: jsonOptions, optimisticConcurrency: true },
);
DonationSchema.index({ campaign: 1, createdAt: -1 });
DonationSchema.index({ village: 1 });
DonationSchema.index({ 'collectedBy.id': 1, createdAt: -1 });
DonationSchema.index({ 'pledgedBy.id': 1, createdAt: -1 }, { partialFilterExpression: { 'pledgedBy.id': { $type: 'objectId' } } });
DonationSchema.index({ receiptNo: 1 }, { unique: true, partialFilterExpression: { receiptNo: { $type: 'number' } } });

const EventSchema = new Schema(
  {
    title: { type: Localized, required: true },
    description: { type: Localized, default: null }, // shown when the event is opened
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
    // How receipt numbers are printed: prefix + number padded to `digits` + suffix ({FY}, {YYYY}, {YY} allowed).
    receiptNumber: {
      prefix: { type: String, default: '', trim: true, maxlength: 30 },
      suffix: { type: String, default: '', trim: true, maxlength: 30 },
      digits: { type: Number, default: 0, min: 0, max: 8 },
    },
    // Link added to messages shared from the app (Play Store page or website), e.g. campaign progress.
    shareLink: { type: String, default: null, trim: true },
    // The website (Netlify) address: the app downloads its UI updates (/ota/manifest.json) from there and
    // links its privacy-policy and account-deletion pages.
    webUrl: { type: String, default: null, trim: true, match: /^https?:\/\/[^\s/]+(\/\S*)?$/ },
    // Newest Android app: older apps offer "Download update" in Profile → About (never automatically).
    appUpdate: {
      version: { type: String, default: null, trim: true, match: /^\d+(\.\d+){0,3}$/ },
      url: { type: String, default: null, trim: true, match: /^https?:\/\/\S+$/ },
      notes: { type: Localized, default: null }, // what's new
    },
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

/** What a home-screen quick link opens. "activities" lists the Activity items whose section is the link's key. */
export const QUICK_ACTIONS = ['activities', 'weddings', 'gallery', 'trustees', 'events', 'donors', 'report', 'link'];

/** Home-screen quick link tile (ઝડપી લિંક), managed in the dashboard. */
const QuickLinkSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    label: { type: Localized, required: true },
    icon: { type: String, default: 'file' }, // built-in icon name (frontend/src/components/quickIcons.jsx)
    iconImage: { type: String, default: null }, // uploaded icon, replaces the built-in one
    action: { type: String, enum: QUICK_ACTIONS, default: 'activities' },
    intro: { type: Localized, default: null }, // shown at the top of an activities page
    link: { type: String, default: null, trim: true }, // for action "link"
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

/** An item on an activities page (social activities, education, vidyarthi bhavan…). */
const ActivitySchema = new Schema(
  {
    section: { type: String, required: true, lowercase: true, index: true }, // QuickLink key
    title: { type: Localized, required: true },
    date: { type: Date, default: null },
    place: { type: Localized, default: null },
    description: { type: Localized, default: null },
    photos: { type: [String], default: [] },
    pdf: { type: String, default: null }, // optional document (PDF)
    order: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

const WeddingDonorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    village: { type: String, default: null, trim: true },
    amount: { type: Number, default: null, min: 0 },
    details: { type: String, default: null, trim: true }, // e.g. an item donated
  },
  { _id: false },
);
const WeddingExpenseSchema = new Schema(
  { item: { type: String, required: true, trim: true }, amount: { type: Number, default: 0, min: 0 } },
  { _id: false },
);
const FactSchema = new Schema(
  { label: { type: String, required: true, trim: true }, value: { type: String, default: '', trim: true } },
  { _id: false },
);

/**
 * One year of the samuh lagna (mass wedding): couples, donors, expenses, report PDF, photos and any other
 * facts. A linked campaign adds that campaign's donations from the app to the donor list.
 */
const WeddingYearSchema = new Schema(
  {
    year: { type: String, required: true, trim: true }, // e.g. "2025-26"
    title: { type: Localized, default: null }, // e.g. "29મો સમૂહ લગ્નોત્સવ"
    date: { type: Date, default: null },
    venue: { type: Localized, default: null },
    couples: { type: Number, default: null, min: 0 },
    photo: { type: String, default: null },
    description: { type: Localized, default: null },
    reportUrl: { type: String, default: null },
    campaign: { type: String, default: null, lowercase: true },
    facts: { type: [FactSchema], default: [] },
    donors: { type: [WeddingDonorSchema], default: [] },
    expenses: { type: [WeddingExpenseSchema], default: [] },
    photos: { type: [String], default: [] },
    order: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

const TrusteeOrgSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: Localized, required: true },
    regNo: { type: Localized, default: null },
    logo: { type: String, default: null }, // uploaded image: the organisation card and the board page
    cover: { type: String, default: null }, // uploaded wide photo at the top of the board page
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

/** Trustee board designation (પ્રમુખ, મહામંત્રી, …), managed by the admin; `order` sets the order on the trustees screen. */
const TrusteeRoleSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: Localized, required: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: jsonOptions },
);

const TrusteeSchema = new Schema(
  {
    name: { type: Localized, required: true },
    role: { type: String, required: true, lowercase: true, index: true }, // TrusteeRole key
    org: { type: String, default: 'ssvj', lowercase: true, index: true }, // TrusteeOrg key
    phone: { type: String, default: null, trim: true },
    photo: { type: String, default: null },
    village: { type: String, default: null, lowercase: true }, // Village key
    order: { type: Number, default: 0 }, // within the designation
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

/** Relation of a family member to the registered head of the family (labels live in the frontend). */
export const RELATIONS = [
  'wife', 'husband', 'son', 'daughter', 'father', 'mother', 'brother', 'sister',
  'daughterInLaw', 'sisterInLaw', 'grandson', 'granddaughter', 'other',
];

const PersonSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    relation: { type: String, enum: RELATIONS, default: 'other' },
    birthYear: { type: Number, default: null },
    education: { type: String, default: null, trim: true },
    occupation: { type: String, default: null, trim: true },
    phone: { type: String, default: null },
  },
  { _id: false },
);

/**
 * A family registered as members of the samaj: the head plus family members. Registered from the app by a
 * logged-in user (one per account, `userId`) or entered by an admin. Contact details are admin/owner only.
 */
const MemberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: null },
    village: { type: String, required: true, lowercase: true, index: true },
    currentPlace: { type: String, default: null, trim: true }, // હાલ રહેઠાણ
    address: { type: String, default: null, trim: true },
    birthYear: { type: Number, default: null },
    education: { type: String, default: null, trim: true },
    occupation: { type: String, default: null, trim: true },
    family: { type: [PersonSchema], default: [] },
    source: { type: String, enum: ['app', 'admin'], default: 'app' },
  },
  { timestamps: true, toJSON: jsonOptions },
);
MemberSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { userId: { $type: 'objectId' } } });

/**
 * Who changed what and when: donations (pledged, collected, edited, approved, rejected, deleted…) and every
 * dashboard edit. `changes` holds field-level before/after; `snapshot` keeps a deleted record.
 */
const ActivityLogSchema = new Schema(
  {
    actor: {
      id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      name: { type: String, default: null },
      phone: { type: String, default: null },
      role: { type: String, default: null }, // null: a donor using the app without logging in
    },
    action: { type: String, required: true, index: true }, // create | update | delete | approve | reject | restore | collect | pledge
    entity: { type: String, required: true, index: true }, // donation | campaigns | members | users | settings…
    entityId: { type: String, default: null, index: true },
    label: { type: String, default: null }, // e.g. "#557 · શ્રી રમેશભાઈ · ₹5,100"
    changes: { type: [{ _id: false, field: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed }], default: [] },
    note: { type: String, default: null }, // reject reason etc.
    snapshot: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, toJSON: jsonOptions },
);
ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ 'actor.id': 1 });

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
    // App build last used (reported by the app on start and login) and when it was last opened.
    appVersion: { type: String, default: null },
    appPlatform: { type: String, default: null }, // android | ios | web
    lastSeenAt: { type: Date, default: null },
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
export const QuickLink = model('QuickLink', QuickLinkSchema);
export const Activity = model('Activity', ActivitySchema);
export const WeddingYear = model('WeddingYear', WeddingYearSchema);
export const TrusteeOrg = model('TrusteeOrg', TrusteeOrgSchema);
export const TrusteeRole = model('TrusteeRole', TrusteeRoleSchema);
export const Trustee = model('Trustee', TrusteeSchema);
export const Member = model('Member', MemberSchema);
export const Settings = model('Settings', SettingsSchema);
export const Counter = model('Counter', CounterSchema);
export const ActivityLog = model('ActivityLog', ActivityLogSchema);
export const User = model('User', UserSchema);
export const Otp = model('Otp', OtpSchema);
