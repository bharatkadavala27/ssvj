// What a fresh database needs before the app can run. Everything else is entered in the admin dashboard.

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

/** Default home-screen quick link tiles (edited afterwards in the dashboard). */
export const quickLinks = [
  { key: 'social', label: { gu: 'સામાજિક પ્રવૃત્તિઓ', en: 'Social activities' }, icon: 'hands', action: 'activities' },
  { key: 'education', label: { gu: 'શૈક્ષણિક પ્રવૃત્તિઓ', en: 'Educational activities' }, icon: 'graduation', action: 'activities' },
  { key: 'bhavan', label: { gu: 'સગર વિદ્યાર્થી ભવન', en: 'Sagar Vidyarthi Bhavan' }, icon: 'building', action: 'activities' },
  { key: 'gallery', label: { gu: 'ફોટો ગેલેરી', en: 'Photo gallery' }, icon: 'image', action: 'gallery' },
  { key: 'wedding', label: { gu: 'સમૂહ લગ્ન', en: 'Mass wedding' }, icon: 'rings', action: 'weddings' },
  { key: 'trustees', label: { gu: 'ટ્રસ્ટી મંડળ', en: 'Trustees' }, icon: 'temple', action: 'trustees' },
];
