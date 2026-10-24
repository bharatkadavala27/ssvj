import { Campaign, Counter, Donation, Settings } from '../models/index.js';
import { placeExists, placeInfo } from './places.js';
import { HttpError } from '../middleware/errors.js';
import { broadcast } from './live.js';
import { initialOf } from './format.js';
import { newReceiptToken } from './auth.js';
import { diff, logActivity } from './activity.js';

const ANON = { gu: 'ગુપ્ત દાતા', en: 'Anonymous donor' };
const ANON_INITIAL = { gu: 'ગુ', en: 'A' };

const staffRef = (u) => (u ? { id: u.id || null, name: u.name || null, phone: u.phone || null } : null);
const counted = (status) => status !== 'rejected';

const rupees = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
/** "#557 · શ્રી રમેશભાઈ · ₹5,100" for the activity log. */
export const donationLabel = (d) =>
  [d.receiptNo && `#${d.receiptNo}`, d.name?.gu, d.material?.gu || (d.amount != null && rupees(d.amount))].filter(Boolean).join(' · ');

/** The editable fields of a donation, flattened for before/after comparison in the log. */
const editable = (d) => ({
  campaign: d.campaign,
  name: d.name?.gu,
  nameEn: d.name?.en,
  village: d.village,
  amount: d.amount ?? null,
  material: d.material?.gu ?? null,
  anon: Boolean(d.anon),
  phone: d.phone ?? null,
  details: d.details ?? null,
  through: d.through ?? null,
  business: d.business ?? null,
  currentPlace: d.currentPlace ?? null,
  receiptNo: d.receiptNo ?? null,
  payMode: d.payMode ?? null,
  payRef: d.payRef ?? null,
  dueDate: d.dueDate ? dueDay(d.dueDate) : null,
});

/** "2026-11-24" (a date input's value) ⇄ noon that day in India, so the day is the same in every time zone. */
export const dueDateOf = (day) => (day ? new Date(`${day}T12:00:00+05:30`) : null);
const dueDay = (date) => new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/**
 * Donors ranked by total given (named, cash donations only). Only approved donations count, so an
 * unverified pledge from the app never reaches the home slider or the top-donor list. `id`
 * ("village:ગુજરાતી name") is what home-slider customisations (Banner.topDonorId) refer to.
 */
export async function topDonors(limit = 10) {
  const rows = await Donation.aggregate([
    { $match: { status: 'approved', anon: false, amount: { $gt: 0 } } },
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
  delete o.payRef;
  o.collectedBy = o.collectedBy?.name ? { name: o.collectedBy.name } : null;
  o.approvedBy = o.approvedBy?.name ? { name: o.approvedBy.name } : null;
  o.pledgedBy = o.pledgedBy?.name ? { name: o.pledgedBy.name } : null;
  return o;
}

/** Staff shape: includes the donor's phone. */
export function donationStaffView(d) {
  const o = donationView(d);
  o.phone = d.phone ?? null;
  o.payRef = d.payRef ?? null;
  o.collectedBy = d.collectedBy?.name ? { id: d.collectedBy.id && String(d.collectedBy.id), name: d.collectedBy.name } : null;
  o.pledgedBy = d.pledgedBy?.name ? { id: d.pledgedBy.id && String(d.pledgedBy.id), name: d.pledgedBy.name } : null;
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
 *  status 'pledged'   — promised in the app, or written down by a sevak to be paid later (no receipt yet)
 *  status 'collected' — money taken by a sevak: receipt number issued now (input.payMode: cash, upi, …)
 *  status 'approved'  — entered directly by an admin
 */
export async function recordDonation(input, { source = 'app', status = 'pledged', actor = null, userId = null } = {}) {
  const campaign = await Campaign.findOne({ key: input.campaign, active: true });
  if (!campaign) throw new HttpError(404, 'Unknown or inactive campaign');
  if (!(await placeExists(input.village))) throw new HttpError(400, 'Unknown village, taluka or district');

  const anon = input.anon || !input.name?.trim();
  const name = anon ? ANON : { gu: input.name.trim(), en: (input.nameEn || input.name).trim() };
  const initial = anon ? ANON_INITIAL : { gu: initialOf(name.gu), en: initialOf(name.en).toUpperCase() };
  const withReceipt = status === 'collected' || status === 'approved';
  const now = new Date();
  const pledgeByStaff = status === 'pledged' && source !== 'app';

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
    payMode: withReceipt && !input.material ? input.payMode || null : null,
    payRef: withReceipt && !input.material ? input.payRef || null : null,
    pledgedBy: pledgeByStaff ? staffRef(actor) : null,
    dueDate: status === 'pledged' ? dueDateOf(input.dueDate) : null,
  });

  const updated = await adjustTotals(donation, 1);
  const view = donationView(donation);
  broadcast('donation', { campaign: campaign.key, donation: view, stats: campaignStats(updated) });
  await logActivity({
    actor: actor || (userId ? { id: userId, role: 'public' } : null),
    action: source === 'app' || pledgeByStaff ? 'pledge' : source === 'sevak' ? 'collect' : 'create',
    entity: 'donation',
    entityId: donation._id,
    label: donationLabel(donation),
    note:
      source === 'app'
        ? 'Pledged in the app'
        : pledgeByStaff
          ? 'Promise written down (payment pending)'
          : source === 'sevak'
            ? 'Receipt issued by a sevak'
            : 'Entered by an admin (approved)',
  });
  return { donation: view, stats: campaignStats(updated), receiptToken: donation.receiptToken, doc: donation };
}

const TRANSITIONS = {
  // from -> allowed targets
  pledged: ['collected', 'approved', 'rejected'],
  collected: ['approved', 'rejected'],
  approved: ['rejected'],
  rejected: ['pledged', 'collected'], // restore (collected if it already had a receipt)
};

/**
 * Moves a donation to a new status, issuing a receipt or reversing the totals as needed. `payMode`/`payRef`
 * record how the money came in when a pledge is collected.
 */
export async function transitionDonation(id, to, actor, { reason, payMode, payRef } = {}) {
  const donation = await Donation.findById(id).select('+phone');
  if (!donation) throw new HttpError(404, 'Donation not found');
  if (donation.status === to) return donation;
  const from = donation.status;
  const receiptBefore = donation.receiptNo ?? null;
  if (!TRANSITIONS[donation.status]?.includes(to)) {
    throw new HttpError(409, `Cannot change a ${donation.status} donation to ${to}`);
  }
  const wasCounted = counted(donation.status);
  const now = new Date();

  const payBefore = donation.payMode ?? null;
  if ((to === 'collected' || to === 'approved') && !donation.receiptNo) {
    donation.receiptNo = await nextReceiptNo();
    donation.collectedBy = staffRef(actor);
    donation.collectedAt = now;
    if (!donation.material && payMode) {
      donation.payMode = payMode;
      donation.payRef = payRef || null;
    }
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
  // Approving (or un-approving) changes the top donors: open apps reload the home slider.
  if (to === 'approved' || from === 'approved') broadcast('refresh', { at: Date.now() });
  const action = to === 'approved' ? 'approve' : to === 'rejected' ? 'reject' : from === 'rejected' ? 'restore' : 'collect';
  await logActivity({
    actor,
    action,
    entity: 'donation',
    entityId: donation._id,
    label: donationLabel(donation),
    changes: [
      { field: 'status', from, to },
      ...(donation.receiptNo !== receiptBefore ? [{ field: 'receiptNo', from: receiptBefore, to: donation.receiptNo }] : []),
      ...((donation.payMode ?? null) !== payBefore ? [{ field: 'payMode', from: payBefore, to: donation.payMode }] : []),
    ],
    note: to === 'rejected' ? reason || null : null,
  });
  return donation;
}

/**
 * Admin edit of a donation's details. Totals are taken out for the old values and put back for the new
 * ones, so changing the amount, campaign or village keeps every campaign's figures right.
 */
export async function updateDonation(id, input, actor) {
  const d = await Donation.findById(id).select('+phone');
  if (!d) throw new HttpError(404, 'Donation not found');
  if (input.updatedAt && new Date(input.updatedAt).getTime() !== d.updatedAt.getTime()) {
    throw new HttpError(409, 'This donation was changed by someone else since you opened it. Close the form, reload and try again.');
  }
  const before = editable(d);

  if (input.campaign && input.campaign !== d.campaign && !(await Campaign.exists({ key: input.campaign }))) {
    throw new HttpError(400, 'Unknown campaign');
  }
  if (input.village && input.village !== d.village && !(await placeExists(input.village))) {
    throw new HttpError(400, 'Unknown village, taluka or district');
  }
  const material = 'material' in input ? input.material || null : d.material?.gu || null;
  const amount = material ? null : 'amount' in input ? input.amount ?? null : d.amount;
  if (!material && !(amount >= 1)) throw new HttpError(400, 'Enter an amount, or an in-kind item');

  if ('receiptNo' in input && input.receiptNo !== (d.receiptNo ?? null)) {
    // Correcting a typo only: a receipt can't be removed, added before the cash is collected, or set to a
    // number the counter hasn't issued yet (it would collide with a future receipt).
    if (input.receiptNo == null) throw new HttpError(400, 'A receipt number cannot be removed; reject the donation instead');
    if (!d.receiptNo) throw new HttpError(400, 'This donation has no receipt yet; it gets one when the cash is collected');
    const counter = await Counter.findById('receipt');
    if (input.receiptNo > (counter?.seq || 0)) throw new HttpError(400, `Receipt numbers above ${counter?.seq || 0} have not been issued yet`);
    if (await Donation.exists({ _id: { $ne: d._id }, receiptNo: input.receiptNo })) {
      throw new HttpError(409, `Receipt ${input.receiptNo} already belongs to another donation`);
    }
  }
  const campaign = input.campaign || d.campaign;
  const village = input.village || d.village;
  const affectsTotals = counted(d.status) && (campaign !== d.campaign || village !== d.village || amount !== d.amount);
  const oldCampaign = d.campaign;
  if (affectsTotals) await adjustTotals(d, -1);

  const anon = 'anon' in input ? input.anon : d.anon;
  const nameGu = 'name' in input ? input.name?.trim() : d.anon ? '' : d.name.gu;
  if (anon || !nameGu) {
    d.name = ANON;
    d.initial = ANON_INITIAL;
    d.anon = true;
  } else {
    const en = ('nameEn' in input ? input.nameEn : d.name.en)?.trim() || nameGu;
    d.name = { gu: nameGu, en };
    d.initial = { gu: initialOf(nameGu), en: initialOf(en).toUpperCase() };
    d.anon = false;
  }
  d.campaign = campaign;
  d.village = village;
  d.amount = amount;
  d.material = material ? { gu: material, en: material } : null;
  for (const k of ['phone', 'details', 'through', 'business', 'currentPlace', 'payMode', 'payRef']) if (k in input) d[k] = input[k] || null;
  if (material) d.payMode = d.payRef = null;
  if ('dueDate' in input) d.dueDate = dueDateOf(input.dueDate);
  if ('receiptNo' in input) d.receiptNo = input.receiptNo ?? null;
  try {
    await d.save();
  } catch (err) {
    if (affectsTotals) await adjustTotals(await Donation.findById(d._id), 1); // put the unchanged donation back
    throw err;
  }
  if (affectsTotals) {
    const updated = await adjustTotals(d, 1);
    if (updated) broadcast('stats', campaignStats(updated));
    if (oldCampaign !== d.campaign) {
      const old = await Campaign.findOne({ key: oldCampaign });
      if (old) broadcast('stats', campaignStats(old));
    }
  }
  broadcast('refresh', { at: Date.now() });
  const changes = diff(before, editable(d));
  if (changes.length) await logActivity({ actor, action: 'update', entity: 'donation', entityId: d._id, label: donationLabel(d), changes });
  return d;
}

/** Deletes a donation for good (its campaign totals are reversed). The log keeps a full copy. */
export async function deleteDonation(id, actor, { reason } = {}) {
  const d = await Donation.findById(id).select('+phone');
  if (!d) throw new HttpError(404, 'Donation not found');
  if (counted(d.status)) {
    const updated = await adjustTotals(d, -1);
    if (updated) broadcast('stats', campaignStats(updated));
  }
  await Donation.deleteOne({ _id: d._id });
  broadcast('refresh', { at: Date.now() });
  const snapshot = d.toObject();
  delete snapshot.receiptToken;
  await logActivity({ actor, action: 'delete', entity: 'donation', entityId: d._id, label: donationLabel(d), note: reason || null, snapshot });
  return d;
}

/** Everything needed to draw a receipt or poster for one donation. */
export async function receiptData(donation) {
  const [campaign, village, settings] = await Promise.all([
    Campaign.findOne({ key: donation.campaign }),
    placeInfo(donation.village),
    Settings.findById('org'),
  ]);
  return {
    donation: { ...donationView(donation), payRef: donation.payRef ?? null }, // the slip prints the payment reference
    campaign: campaign && { id: campaign.key, label: campaign.label, poster: campaign.poster },
    village, // { key, kind, name, taluka, district }; name is empty for a taluka or district
    settings,
  };
}
