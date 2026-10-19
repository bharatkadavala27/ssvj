// Initial content, mirroring the app's bundled sample data (frontend/src/data/mock.js).

export const villages = [
  ['vanthali', 'વંથલી', 'Vanthali'],
  ['keshod', 'કેશોદ', 'Keshod'],
  ['mendarda', 'મેંદરડા', 'Mendarda'],
  ['bhesan', 'ભેસાણ', 'Bhesan'],
  ['visavadar', 'વિસાવદર', 'Visavadar'],
  ['manavadar', 'માણાવદર', 'Manavadar'],
  ['junagadh', 'જૂનાગઢ', 'Junagadh'],
].map(([key, gu, en], order) => ({
  key,
  name: { gu, en },
  // These sample places are taluka towns of Junagadh district; edit per village in the dashboard.
  taluka: { gu, en },
  district: { gu: 'જૂનાગઢ', en: 'Junagadh' },
  order,
}));

export const campaigns = [
  {
    key: 'mandir',
    label: { gu: 'મંદિર નિર્માણ', en: 'Temple construction' },
    target: 6100000,
    collected: 3845000,
    donors: 1248,
    villages: 42,
    order: 0,
    poster: { title: { gu: 'મંદિર નિર્માણ', en: 'Temple Construction' }, date: null, venue: null },
  },
  {
    key: 'lagna',
    label: { gu: 'સમૂહ લગ્ન 2027', en: 'Mass wedding 2027' },
    target: 1200000,
    collected: 780000,
    donors: 386,
    villages: 27,
    order: 1,
    poster: {
      title: { gu: 'સમૂહ લગ્નોત્સવ 2027', en: 'Mass Wedding Festival 2027' },
      date: new Date('2027-02-07T08:00:00+05:30'),
      venue: {
        gu: 'શ્રી ભગીરથ ગંગા વાડી, મુ. અકાળા, કેરાળા રોડ, તા. માળીયા હાટીના, જી. જૂનાગઢ',
        en: 'Shree Bhagirath Ganga Wadi, Akala, Kerala Road, Ta. Maliya Hatina, Dist. Junagadh',
      },
    },
  },
];

/** Organisation details, taken from the samaj's logo, receipt book and poster. */
export const settings = {
  _id: 'org',
  name: { gu: 'શ્રી સગર જ્ઞાતિ સમાજ વિભાગ-જુનાગઢ', en: 'Shree Sagar Gnati Samaj Vibhag, Junagadh' },
  shortName: { gu: 'સગર સમાજ', en: 'Sagar Samaj' },
  regNo: { gu: 'રજી. નં. એ/૧૯૦૩', en: 'Reg. No. A/1903' },
  logo: null,
  blessings: [
    { gu: '|| જય દાસારામ ||', en: '|| Jay Dasaram ||' },
    { gu: '|| શ્રી ગણેશાય નમઃ ||', en: '|| Shree Ganeshay Namah ||' },
    { gu: '|| જય ભગીરથ ||', en: '|| Jay Bhagirath ||' },
  ],
  contacts: [
    { name: { gu: 'શ્રી રમેશભાઈ કોદવલા', en: 'Shri Rameshbhai Kodavala' }, role: { gu: 'પ્રમુખશ્રી સગર સમાજ', en: 'President, Sagar Samaj' }, phone: '9904380976' },
    { name: { gu: 'શ્રી ગીરીશભાઈ શીર', en: 'Shri Girishbhai Shir' }, role: { gu: 'મહામંત્રીશ્રી સગર સમાજ', en: 'General Secretary, Sagar Samaj' }, phone: '9722315218' },
    { name: { gu: 'શ્રી પરસોત્તમભાઈ ભંભાણા', en: 'Shri Parsottambhai Bhambhana' }, role: { gu: 'ટ્રસ્ટીશ્રી સગર સમાજ', en: 'Trustee, Sagar Samaj' }, phone: '9898123771' },
  ],
  receiptFooter: {
    gu: 'કાઉન્ટર છોડતા પહેલા નામ, વિગત અને રકમ તપાસી લેવી.',
    en: 'Please check the name, details and amount before leaving the counter.',
  },
};

export const gallery = [
  ['somnath', 'સોમનાથ મંદિર', 'Somnath temple'],
  ['junagadh-swaminarayan', 'સ્વામિનારાયણ મંદિર, જૂનાગઢ', 'Swaminarayan temple, Junagadh'],
  ['girnar', 'ગિરનાર', 'Girnar'],
  ['wedding-mandap', 'લગ્ન મંડપ', 'Wedding mandap'],
  ['wedding-garlands', 'વરમાળા', 'Varmala'],
  ['damodar-kund', 'દામોદર કુંડ', 'Damodar Kund'],
  ['somnath-evening', 'સોમનાથ સંધ્યા', 'Somnath at dusk'],
  ['diya', 'દીપ પ્રાગટ્ય', 'Diyas'],
].map(([photo, gu, en], order) => ({ photo, caption: { gu, en }, order }));

const people = {
  ramesh: { name: { gu: 'રમેશભાઈ ભીખાભાઈ સગર', en: 'Rameshbhai Bhikhabhai Sagar' }, initial: { gu: 'ર', en: 'R' }, village: 'vanthali' },
  vinod: { name: { gu: 'વિનોદભાઈ નાથાભાઈ સગર', en: 'Vinodbhai Nathabhai Sagar' }, initial: { gu: 'વિ', en: 'V' }, village: 'keshod' },
  mansukh: { name: { gu: 'મનસુખભાઈ કરશનભાઈ સગર', en: 'Mansukhbhai Karshanbhai Sagar' }, initial: { gu: 'મ', en: 'M' }, village: 'mendarda' },
  hansa: { name: { gu: 'હંસાબેન જયંતીલાલ સગર', en: 'Hansaben Jayantilal Sagar' }, initial: { gu: 'હં', en: 'H' }, village: 'bhesan' },
  dinesh: { name: { gu: 'દિનેશભાઈ પોપટભાઈ સગર', en: 'Dineshbhai Popatbhai Sagar' }, initial: { gu: 'દિ', en: 'D' }, village: 'visavadar' },
  gita: { name: { gu: 'ગીતાબેન રમણીકભાઈ સગર', en: 'Gitaben Ramnikbhai Sagar' }, initial: { gu: 'ગી', en: 'G' }, village: 'manavadar' },
};
const anon = (village) => ({ name: { gu: 'ગુપ્ત દાતા', en: 'Anonymous donor' }, initial: { gu: 'ગુ', en: 'A' }, village, anon: true });
const person = (key) => ({ ...people[key], photo: key });

const HOUR = 3600 * 1000;
const ago = (h) => new Date(Date.now() - h * HOUR);

/**
 * Seed donations. Older gifts are sized so each major donor's total matches the design
 * (e.g. Vinodbhai: 90,111 earlier + 21,000 today = 1,11,111).
 */
export const donations = [
  { ...person('ramesh'), campaign: 'mandir', amount: 151000, createdAt: ago(24 * 40) },
  { ...person('vinod'), campaign: 'mandir', amount: 90111, createdAt: ago(24 * 35) },
  { ...person('mansukh'), campaign: 'mandir', amount: 50000, createdAt: ago(24 * 30) },
  { ...person('hansa'), campaign: 'mandir', amount: 51000, createdAt: ago(24 * 25) },
  { ...person('hansa'), campaign: 'mandir', material: { gu: 'ચાંદીની વીંટી', en: 'Silver ring' }, createdAt: ago(26) },
  { ...anon('vanthali'), campaign: 'mandir', amount: 11000, createdAt: ago(3) },
  { ...person('vinod'), campaign: 'mandir', amount: 21000, createdAt: ago(1) },
  { ...person('gita'), campaign: 'lagna', amount: 5100, createdAt: ago(27) },
  { ...person('dinesh'), campaign: 'lagna', material: { gu: 'ડીશ સેટ, 51 નંગ', en: 'Dish set, 51 pcs' }, createdAt: ago(4) },
  { ...person('mansukh'), campaign: 'lagna', amount: 51000, createdAt: ago(2) },
].map((d) => ({ status: 'approved', source: 'seed', anon: false, ...d, updatedAt: d.createdAt }));

export const banners = [
  { photo: 'somnath', donor: { ...person('ramesh'), amount: 151000 }, cause: { gu: 'મંદિર નિર્માણ', en: 'temple construction' }, order: 0 },
  { photo: 'junagadh-swaminarayan', donor: { ...person('vinod'), amount: 111111 }, cause: { gu: 'મંદિર નિર્માણ', en: 'temple construction' }, order: 1 },
  { photo: 'wedding-garlands', donor: { ...person('mansukh'), amount: 51000 }, cause: { gu: 'સમૂહ લગ્ન', en: 'the mass wedding' }, order: 2 },
];

export const sponsors = [
  ['shreeji', 'શ્રીજી જ્વેલર્સ', 'Shreeji Jewellers'],
  ['girnar', 'ગિરનાર ટ્રેડર્સ', 'Girnar Traders'],
  ['transport', 'સગર ટ્રાન્સપોર્ટ', 'Sagar Transport'],
  ['dairy', 'મહાદેવ ડેરી', 'Mahadev Dairy'],
].map(([key, gu, en], order) => ({ key, name: { gu, en }, order }));

export const events = [
  {
    title: { gu: 'મંદિર ભૂમિપૂજન', en: 'Temple Bhoomi Pujan' },
    place: { gu: 'મંદિર સ્થળ, જૂનાગઢ', en: 'Temple site, Junagadh' },
    date: new Date('2026-12-14T09:00:00+05:30'),
    photo: 'girnar',
  },
  {
    title: { gu: 'સમૂહ લગ્નોત્સવ 2027', en: 'Mass Wedding Festival 2027' },
    place: { gu: 'સમાજ વાડી, જૂનાગઢ', en: 'Samaj Wadi, Junagadh' },
    date: new Date('2027-02-07T08:00:00+05:30'),
    photo: 'wedding-mandap',
  },
];

export const notifications = [
  { title: { gu: 'મંદિર ભૂમિપૂજન 14 ડિસેમ્બરે', en: 'Temple Bhoomi Pujan on 14 December' }, body: { gu: 'સર્વે સભ્યોને સવારે 9:00 વાગ્યે ઉપસ્થિત રહેવા વિનંતી.', en: 'All members are requested to attend at 9:00 AM.' }, createdAt: ago(2) },
  { title: { gu: 'મંદિર નિર્માણ 63% પૂર્ણ', en: 'Temple fund 63% complete' }, body: { gu: '1,248 દાતાઓનો હાર્દિક આભાર.', en: 'Heartfelt thanks to 1,248 donors.' }, createdAt: ago(24) },
  { title: { gu: 'સમૂહ લગ્ન 2027 નોંધણી શરૂ', en: 'Mass wedding 2027 registration open' }, body: { gu: 'નોંધણી માટે સમાજ કાર્યાલયનો સંપર્ક કરો.', en: 'Contact the samaj office to register.' }, createdAt: ago(72) },
].map((n) => ({ ...n, updatedAt: n.createdAt }));
