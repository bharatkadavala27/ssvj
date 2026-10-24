import { connectDb, disconnectDb } from '../config/db.js';
import { Trustee, TrusteeOrg, User } from '../models/index.js';

const orgs = [
  {
    key: 'ssvj',
    name: {
      gu: 'શ્રી સગર જ્ઞાતિ સમાજ વિભાગ - જુનાગઢ',
      en: 'Shri Sagar Gnati Samaj Vibhag - Junagadh',
    },
    regNo: {
      gu: 'એ-1903',
      en: 'A-1903',
    },
    order: 0,
    active: true,
  },
  {
    key: 'bhavan',
    name: {
      gu: 'શ્રી સોરઠીયા સગર વિધાર્થી ભવન - જુનાગઢ',
      en: 'Shri Sorathiya Sagar Vidyarthi Bhavan - Junagadh',
    },
    regNo: {
      gu: 'એ-1763',
      en: 'A-1763',
    },
    order: 1,
    active: true,
  },
];

const bhavanTrustees = [
  {
    role: 'pramukh',
    gu: 'શ્રી નરેશભાઈ કાળાભાઈ નનેરા',
    en: 'Shri Nareshbhai Kalabhai Nanera',
    phone: '8690153486',
    order: 0,
  },
  {
    role: 'upapramukh',
    gu: 'શ્રી વિનોદભાઈ નાનજીભાઈ મારૂ',
    en: 'Shri Vinodbhai Nanjibhai Maru',
    phone: '9825264484',
    order: 0,
  },
  {
    role: 'mantri',
    gu: 'શ્રી વિજયભાઈ હરજીભાઈ પિપરોતર',
    en: 'Shri Vijaybhai Harjibhai Piprotar',
    phone: '9925042043',
    order: 0,
  },
  {
    role: 'sabhya',
    gu: 'શ્રી ગોકળભાઈ ડાયાભાઈ કારેણા',
    en: 'Shri Gokalbhai Dayabhai Karena',
    phone: '9723349518',
    order: 0,
  },
  {
    role: 'sabhya',
    gu: 'શ્રી છગનભાઈ અરજણભાઈ કોદાવલા',
    en: 'Shri Chhaganbhai Arjanbhai Kodavala',
    phone: '9998235645',
    order: 1,
  },
  {
    role: 'sabhya',
    gu: 'શ્રી નાનજીભાઈ અરજણભાઈ કળથિયા',
    en: 'Shri Nanjibhai Arjanbhai Kalthiya',
    phone: '9909463368',
    order: 2,
  },
  {
    role: 'sabhya',
    gu: 'શ્રી ભરતભાઈ કાનજીભાઈ કારેણા',
    en: 'Shri Bharatbhai Kanjibhai Karena',
    phone: '9978075138',
    order: 3,
  },
  {
    role: 'sabhya',
    gu: 'શ્રી હરેશભાઈ ભગવાનજીભાઈ કોદાવલા',
    en: 'Shri Hareshbhai Bhagwanjibhai Kodavala',
    phone: '6353134615',
    order: 4,
  },
  {
    role: 'sabhya',
    gu: 'શ્રી જગદીશભાઈ ભીખાભાઈ પાથર',
    en: 'Shri Jagdishbhai Bhikhabhai Pathar',
    phone: '9586235865',
    order: 5,
  },
  {
    role: 'sabhya',
    gu: 'શ્રી વિનોદભાઈ અરજણભાઈ સોલંકી',
    en: 'Shri Vinodbhai Arjanbhai Solanki',
    phone: '9328423515',
    order: 6,
  },
  {
    role: 'sabhya',
    gu: 'શ્રી હરેશભાઈ મનજીભાઈ કળથિયા',
    en: 'Shri Hareshbhai Manjibhai Kalthiya',
    phone: '9904484042',
    order: 7,
  },
];

try {
  await connectDb();

  // 1. Upsert Trustee Organizations
  for (const o of orgs) {
    await TrusteeOrg.findOneAndUpdate(
      { key: o.key },
      { $set: o },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`✓ Upserted organization: ${o.name.gu} (${o.key})`);
  }

  // 2. Set org: 'ssvj' for any existing trustees without org
  const updatedExisting = await Trustee.updateMany(
    { $or: [{ org: null }, { org: { $exists: false } }] },
    { $set: { org: 'ssvj' } }
  );
  console.log(`✓ Updated ${updatedExisting.modifiedCount} existing trustees to org: 'ssvj'`);

  // 3. Add Bhavan trustees
  const existingBhavan = new Set(
    (await Trustee.find({ org: 'bhavan' }).lean()).map((t) => t.name.gu.trim())
  );

  let addedTrustees = 0;
  for (const t of bhavanTrustees) {
    if (!existingBhavan.has(t.gu)) {
      await Trustee.create({
        name: { gu: t.gu, en: t.en },
        role: t.role,
        org: 'bhavan',
        phone: t.phone,
        order: t.order,
        active: true,
      });
      addedTrustees++;
      console.log(`✓ Added trustee: ${t.gu} (${t.role})`);
    } else {
      console.log(`- Trustee already exists: ${t.gu}`);
    }
  }
  console.log(`Total new Bhavan trustees added: ${addedTrustees}`);

  // 4. Ensure Bhavan trustees are also added as Sevak users
  let addedUsers = 0;
  for (const t of bhavanTrustees) {
    const phone = t.phone.replace(/\D/g, '').slice(-10);
    const existingUser = await User.findOne({ phone });
    if (!existingUser) {
      await User.create({
        name: t.gu,
        phone,
        role: 'sevak',
        villages: [],
        active: true,
      });
      addedUsers++;
      console.log(`✓ Created sevak user: ${t.gu} (${phone})`);
    } else {
      console.log(`- User already exists: ${t.gu} (${phone}) role: ${existingUser.role}`);
    }
  }
  console.log(`Total new Sevak users created: ${addedUsers}`);

  console.log('\nMigration completed successfully!');
} catch (err) {
  console.error('Migration failed:', err);
} finally {
  await disconnectDb();
}

