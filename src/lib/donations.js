import { Campaign, Counter, Donation, Settings, Village } from '../models/index.js';
import { HttpError } from '../middleware/errors.js';
import { broadcast } from './live.js';
import { initialOf } from './format.js';
import { newReceiptToken } from './auth.js';

const ANON = { gu: 'ગુપ્ત દાતા', en: 'Anonymous donor' };
const ANON_INITIAL = { gu: 'ગુ', en: 'A' };

const staffRef = (u) => (u ? { id: u.id || null, name: u.name || null, phone: u.phone || null } : null);
const counted = (status) => status !== 'rejected';

/**
 * Donors ranked by total given (named, cash donations only). `id` ("village:ગુજરાતી name") is what
 * home-slider customisations (Banner.topDonorId) refer to.
 */
export async function topDonors(limit = 10) {
  const rows = await Donation.aggregate([
    { $match: { status: { $ne: 'rejected' }, anon: false, amount: { $gt: 0 } } },
    {
      $group: {
        _id: { name: '$name.gu', village: '$village' },
        amount: { $sum: '$amount' },
        name: { $first: '$name' },
        initial: { $first: '$initial' },
        photo: { $max: '$photo' },
        village: { $first: '$village' },
      },
    },
    { $sort: { amount: -1 } },
    { $limit: limit },
  ]);
  return rows.map((r) => ({ id: `${r.village}:${r.name.gu}`, name: r.name, initial: r.initial, photo: r.photo, village: r.village, amount: r.amount }));
}

/** Public shape of a donation: no donor phone, receipt token, account id or staff phone numbers. */
export function donationView(d) {
  const o = d.toJSON ? d.toJSON() : { ...d, id: String(d._id) };
  delete o._id;
  delete o.__v;
  delete o.phone;
  delete o.receiptToken;
  delete o.userId;
  o.collectedBy = o.collectedBy?.name ? { name: o.collectedBy.name } : null;
  o.approvedBy = o.approvedBy?.name ? { name: o.approvedBy.name } : null;
  return o;
}

/** Staff shape: includes the donor's phone. */
export function donationStaffView(d) {
  const o = donationView(d);
  o.phone = d.phone ?? null;
  o.collectedBy = d.collectedBy?.name ? { id: d.collectedBy.id && String(d.collectedBy.id), name: d.collectedBy.name } : null;
  return o;
}

export function campaignStats(c) {
  return { id: c.key, collected: c.collected, donors: c.donors, villages: c.villages, target: c.target };
}

async function nextReceiptNo() {
  const c = await Counter.findOneAndUpdate({ _id: 'receipt' }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return c.seq;
}

async function adjustTotals(donation, sign) {
  const othersFromVillage = await Donation.exists({
    _id: { $ne: donation._id },
    campaign: donation.campaign,
    village: donation.village,
    status: { $ne: 'rejected' },
  });
  const updated = await Campaign.findOneAndUpdate(
    { key: donation.campaign },
    { $inc: { collected: sign * (donation.amount || 0), donors: sign, villages: othersFromVillage ? 0 : sign } },
    { new: true },
  );
  return updated;
}

/**
 * Records a donation and updates the campaign totals.
 *  status 'pledged'   — promised in the app (no receipt yet)
 *  status 'collected' — cash taken by a sevak: receipt number issued now
 *  status 'approved'  — entered directly by an admin
 */
export async function recordDonation(input, { source = 'app', status = 'pledged', actor = null, userId = null } = {}) {
  const campaign = await Campaign.findOne({ key: input.campaign, active: true });
  if (!campaign) throw new HttpError(404, 'Unknown or inactive campaign');
  if (!(await Village.exists({ key: input.village }))) throw new HttpError(400, 'Unknown village');

  const anon = input.anon || !input.name?.trim();
  const name = anon ? ANON : { gu: input.name.trim(), en: (input.nameEn || input.name).trim() };
  const initial = anon ? ANON_INITIAL : { gu: initialOf(name.gu), en: initialOf(name.en).toUpperCase() };
  const withReceipt = status === 'collected' || status === 'approved';
  const now = new Date();

  const donation = await Donation.create({
    campaign: campaign.key,
    name,
    initial,
    village: input.village,
    amount: input.material ? null : input.amount,
    material: input.material ? { gu: input.material, en: input.material } : null,
    anon,
    phone: input.phone || null,
    userId,
    status,
    source,
    receiptNo: withReceipt ? await nextReceiptNo() : null,
    receiptToken: newReceiptToken(),
    details: input.details || null,
    through: input.through || null,
    business: input.business || null,
    currentPlace: input.currentPlace || null,
    collectedBy: withReceipt ? staffRef(actor) : null,
    collectedAt: withReceipt ? now : null,
    approvedBy: status === 'approved' ? staffRef(actor) : null,
    approvedAt: status === 'approved' ? now : null,
  });

  const updated = await adjustTotals(donation, 1);
  const view = donationView(donation);
  broadcast('donation', { campaign: campaign.key, donation: view, stats: campaignStats(updated) });
  return { donation: view, stats: campaignStats(updated), receiptToken: donation.receiptToken, doc: donation };
}

const TRANSITIONS = {
  // from -> allowed targets
  pledged: ['collected', 'approved', 'rejected'],
  collected: ['approved', 'rejected'],
  approved: ['rejected'],
  rejected: ['pledged', 'collected'], // restore (collected if it already had a receipt)
};

/** Moves a donation to a new status, issuing a receipt or reversing the totals as needed. */
export async function transitionDonation(id, to, actor, { reason } = {}) {
  const donation = await Donation.findById(id).select('+phone');
  if (!donation) throw new HttpError(404, 'Donation not found');
  if (donation.status === to) return donation;
  if (!TRANSITIONS[donation.status]?.includes(to)) {
    throw new HttpError(409, `Cannot change a ${donation.status} donation to ${to}`);
  }
  const wasCounted = counted(donation.status);
  const now = new Date();

  if ((to === 'collected' || to === 'approved') && !donation.receiptNo) {
    donation.receiptNo = await nextReceiptNo();
    donation.collectedBy = staffRef(actor);
    donation.collectedAt = now;
  }
  if (to === 'approved') {
    donation.approvedBy = staffRef(actor);
    donation.approvedAt = now;
  }
  donation.rejectReason = to === 'rejected' ? reason || null : null;
  donation.status = to;
  await donation.save();

  if (wasCounted !== counted(to)) {
    const updated = await adjustTotals(donation, counted(to) ? 1 : -1);
    if (updated) broadcast('stats', campaignStats(updated));
  }
  broadcast('status', { id: String(donation._id), status: to });
  return donation;
}

/** Everything needed to draw a receipt or poster for one donation. */
export async function receiptData(donation) {
  const [campaign, village, settings] = await Promise.all([
    Campaign.findOne({ key: donation.campaign }),
    Village.findOne({ key: donation.village }),
    Settings.findById('org'),
  ]);
  return {
    donation: donationView(donation),
    campaign: campaign && { id: campaign.key, label: campaign.label, poster: campaign.poster },
    village: village && { key: village.key, name: village.name, taluka: village.taluka, district: village.district },
    settings,
  };
}
