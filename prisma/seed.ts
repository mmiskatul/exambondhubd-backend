import { PrismaClient, UserRole, UserStatus, PortalGroup } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting ExamBondhuBD Database Seeding...');

  // 1. Create Super Admin from Environment Variables
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@exambondhubd.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';
  const adminName = process.env.ADMIN_NAME || 'ExamBondhuBD Admin';

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const superAdmin = await prisma.user.upsert({
    where: { email: adminEmail.toLowerCase() },
    update: {
      password: hashedPassword,
      name: adminName,
    },
    create: {
      email: adminEmail.toLowerCase(),
      password: hashedPassword,
      name: adminName,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      profile: { create: {} },
    },
  });

  console.log(`👤 Seeded Super Admin: ${superAdmin.email}`);

  // 2. Create Categories
  const categoriesData = [
    {
      titleEn: 'Government Jobs',
      titleBn: 'সরকারি চাকরি',
      slug: 'govt-jobs',
      icon: 'landmark',
      description: 'BCS, NTRCA, Primary Teacher, Bank Jobs, Railway & Ministry Exams',
      sortOrder: 1,
    },
    {
      titleEn: 'University Admission',
      titleBn: 'বিশ্ববিদ্যালয় ভর্তি',
      slug: 'university-admission',
      icon: 'graduation-cap',
      description: 'DU, JU, RU, CU, GST and General Universities Admission',
      sortOrder: 2,
    },
    {
      titleEn: 'Medical Admission',
      titleBn: 'মেডিকেল ভর্তি',
      slug: 'medical-admission',
      icon: 'stethoscope',
      description: 'MBBS, BDS and Armed Forces Medical College Tests',
      sortOrder: 3,
    },
    {
      titleEn: 'Engineering Admission',
      titleBn: 'প্রকৌশল ভর্তি',
      slug: 'engineering-admission',
      icon: 'cpu',
      description: 'CKET, BUTEX and Engineering University Admission',
      sortOrder: 4,
    },
    {
      titleEn: 'Bank Jobs',
      titleBn: 'ব্যাংক চাকরি',
      slug: 'bank-jobs',
      icon: 'briefcase',
      description: 'Bangladesh Bank, Combined 8 Banks, Private Banks Exam Prep',
      sortOrder: 5,
    },
  ];

  const categories: Record<string, any> = {};
  for (const cat of categoriesData) {
    categories[cat.slug] = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: cat,
      create: cat,
    });
  }
  console.log(`📁 Seeded ${Object.keys(categories).length} Categories.`);

  // 3. Create Subjects & Topics
  const subjectsData = [
    {
      titleEn: 'Bangla Language & Literature',
      titleBn: 'বাংলা ভাষা ও সাহিত্য',
      code: 'BANGLA',
      icon: 'book-open',
      topics: [
        { titleEn: 'Bangla Grammar & Syntax', titleBn: 'বাংলা ব্যাকরণ ও বাক্যতত্ত্ব' },
        { titleEn: 'Ancient & Medieval Literature', titleBn: 'প্রাচীন ও মধ্যযুগীয় সাহিত্য' },
        { titleEn: 'Modern Bangla Literature', titleBn: 'আধুনিক বাংলা সাহিত্য' },
        { titleEn: 'Idioms, Synonyms & Antonyms', titleBn: 'বাগধারা, সমার্থক ও বিপরীতার্থক শব্দ' },
      ],
    },
    {
      titleEn: 'English Language & Literature',
      titleBn: 'ইংরেজি ভাষা ও সাহিত্য',
      code: 'ENGLISH',
      icon: 'languages',
      topics: [
        { titleEn: 'Parts of Speech & Grammar', titleBn: 'পার্টস অফ স্পিচ ও গ্রামার' },
        { titleEn: 'Vocabulary, Synonyms & Antonyms', titleBn: 'শব্দভাণ্ডার, সমার্থক ও বিপরীত' },
        { titleEn: 'Idioms, Phrases & Prepositions', titleBn: 'বাগধারা ও প্রিপজিশন' },
        { titleEn: 'English Literary Periods & Authors', titleBn: 'ইংরেজি সাহিত্যের যুগ ও সাহিত্যিক' },
      ],
    },
    {
      titleEn: 'Bangladesh Affairs',
      titleBn: 'বাংলাদেশ বিষয়াবলী',
      code: 'BD_AFFAIRS',
      icon: 'flag',
      topics: [
        { titleEn: 'History, Liberation War & Language Movement', titleBn: 'ইতিহাস, মুক্তিযুদ্ধ ও ভাষা আন্দোলন' },
        { titleEn: 'Constitution & Governance of Bangladesh', titleBn: 'বাংলাদেশের সংবিধান ও সরকার ব্যবস্থা' },
        { titleEn: 'Economy, National Budget & Megaprojects', titleBn: 'অর্থনীতি, বাজেট ও মেগাপ্রকল্প' },
        { titleEn: 'Geography, Demographics & Culture', titleBn: 'ভৌগোলিক পরিবেশ, জনসংখ্যা ও সংস্কৃতি' },
      ],
    },
    {
      titleEn: 'International Affairs',
      titleBn: 'আন্তর্জাতিক বিষয়াবলী',
      code: 'INT_AFFAIRS',
      icon: 'globe',
      topics: [
        { titleEn: 'Global Geopolitics & Treaties', titleBn: 'বৈশ্বিক ভূ-রাজনীতি ও চুক্তি' },
        { titleEn: 'International Organizations (UN, WB, IMF)', titleBn: 'আন্তর্জাতিক সংস্থা (জাতিসংঘ, বিশ্বব্যাংক)' },
        { titleEn: 'Environmental Summits & Global Economy', titleBn: 'পরিবেশ সম্মেলন ও বিশ্ব অর্থনীতি' },
      ],
    },
    {
      titleEn: 'Mathematical Reasoning & Mental Ability',
      titleBn: 'গাণিতিক যুক্তি ও মানসিক দক্ষতা',
      code: 'MATH_MENTAL',
      icon: 'calculator',
      topics: [
        { titleEn: 'Arithmetic, Percentage & Ratio', titleBn: 'পাটিগণিত, শতকরা ও অনুপাত' },
        { titleEn: 'Algebra, Equations & Sequences', titleBn: 'বীজগণিত, সমীকরণ ও ধারা' },
        { titleEn: 'Geometry & Trigonometry', titleBn: 'জ্যামিতি ও ত্রিকোণমিতি' },
        { titleEn: 'Analytical Reasoning & Spatial Ability', titleBn: 'বিশ্লেষণাত্মক যুক্তি ও মানসিক দক্ষতা' },
      ],
    },
    {
      titleEn: 'General Science',
      titleBn: 'সাধারণ বিজ্ঞান',
      code: 'SCIENCE',
      icon: 'atom',
      topics: [
        { titleEn: 'Physics in Everyday Life', titleBn: 'দৈনন্দিন জীবনে পদার্থবিজ্ঞান' },
        { titleEn: 'Human Physiology & Nutrition', titleBn: 'মানব শারীরবিদ্যা ও পুষ্টি' },
        { titleEn: 'Atmosphere, Ecology & Diseases', titleBn: 'বায়ুমণ্ডল, পরিবেশ ও রোগব্যাধি' },
      ],
    },
    {
      titleEn: 'Computer & Information Technology',
      titleBn: 'কম্পিউটার ও তথ্যপ্রযুক্তি',
      code: 'ICT',
      icon: 'laptop',
      topics: [
        { titleEn: 'Computer Hardware, OS & Memory', titleBn: 'কম্পিউটার হার্ডওয়্যার, ওএস ও মেমোরি' },
        { titleEn: 'Internet, Networking & Cyber Security', titleBn: 'ইন্টারনেট, নেটওয়ার্কিং ও সাইবার নিরাপত্তা' },
        { titleEn: 'Database, Number System & Software', titleBn: 'ডাটাবেজ, সংখ্যা পদ্ধতি ও সফটওয়্যার' },
      ],
    },
    {
      titleEn: 'Biology',
      titleBn: 'জীববিজ্ঞান',
      code: 'BIOLOGY',
      icon: 'dna',
      topics: [
        { titleEn: 'Cell Biology & Genetics (কোষ ও বংশগতি)', titleBn: 'কোষ ও বংশগতিবিদ্যা' },
        { titleEn: 'Human Physiology (মানব শারীরতত্ত্ব)', titleBn: 'মানব শারীরস্থান ও অঙ্গতন্ত্র' },
        { titleEn: 'Plant Diversity & Reproduction (উদ্ভিদ শারীরতত্ত্ব)', titleBn: 'উদ্ভিদ শারীরতত্ত্ব ও প্রজনন' },
        { titleEn: 'Genetics & Biotechnology (জিনতত্ত্ব ও জীবপ্রযুক্তি)', titleBn: 'জিনতত্ত্ব ও জীবপ্রযুক্তি' },
      ],
    },
    {
      titleEn: 'Chemistry',
      titleBn: 'রসায়ন',
      code: 'CHEMISTRY',
      icon: 'flask-conical',
      topics: [
        { titleEn: 'Organic Chemistry (জৈব রসায়ন)', titleBn: 'জৈব রসায়ন' },
        { titleEn: 'Periodic Table & Chemical Bonds (পর্যায় সারণি ও বন্ধন)', titleBn: 'পর্যায় সারণি ও রাসায়নিক বন্ধন' },
        { titleEn: 'Qualitative & Quantitative Chemistry (গুণগত ও পরিমাণগত রসায়ন)', titleBn: 'গুণগত ও পরিমাণগত রসায়ন' },
        { titleEn: 'Electrochemistry & Reaction Rate (তড়িৎ রসায়ন ও বিক্রিয়ার হার)', titleBn: 'তড়িৎ রসায়ন' },
      ],
    },
    {
      titleEn: 'Physics',
      titleBn: 'পদার্থবিজ্ঞান',
      code: 'PHYSICS',
      icon: 'zap',
      topics: [
        { titleEn: 'Newtonian Mechanics & Gravity (বলবিদ্যা ও মহাকর্ষ)', titleBn: 'বলবিদ্যা ও মহাকর্ষ' },
        { titleEn: 'Thermodynamics & Waves (তাপগতিবিদ্যা ও তরঙ্গ)', titleBn: 'তাপগতিবিদ্যা ও তরঙ্গ' },
        { titleEn: 'Electricity & Magnetism (চলতড়িৎ ও স্থিরতড়িৎ)', titleBn: 'চলতড়িৎ ও স্থিরতড়িৎ' },
        { titleEn: 'Modern Physics & Optics (আধুনিক পদার্থবিজ্ঞান ও আলো)', titleBn: 'আধুনিক পদার্থবিজ্ঞান ও আলো' },
      ],
    },
    {
      titleEn: 'General Knowledge',
      titleBn: 'সাধারণ জ্ঞান (বাংলাদেশ ও আন্তর্জাতিক)',
      code: 'GK',
      icon: 'globe',
      topics: [
        { titleEn: 'Liberation War of Bangladesh (মুক্তিযুদ্ধ ও বঙ্গবন্ধু)', titleBn: 'মুক্তিযুদ্ধ ও বঙ্গবন্ধু' },
        { titleEn: 'Geography, Heritage & Culture (ভূগোল, ঐতিহ্য ও সংস্কৃতি)', titleBn: 'ভূগোল, ঐতিহ্য ও সংস্কৃতি' },
        { titleEn: 'Recent National & Global Affairs (সাম্প্রতিক তথ্য)', titleBn: 'সাম্প্রতিক তথ্য' },
      ],
    },
  ];

  // subjectsData above is a TEMPLATE. Subjects are no longer global rows —
  // each exam portal (and each unit inside it) gets its own copy, created in
  // the portal loop below, so DU's Bangla and BCS's Bangla are separate
  // records with separate chapters.
  const subjectTemplates: Record<string, (typeof subjectsData)[number]> = {};
  subjectsData.forEach((sub) => {
    subjectTemplates[sub.code] = sub;
  });

  console.log(`📚 Prepared ${subjectsData.length} subject templates.`);

  // 4. Create Subscription Plans
  const plansData = [
    {
      code: 'FREE',
      nameEn: 'Starter Free',
      nameBn: 'ফ্রি প্ল্যান',
      descriptionEn: 'Basic access to sample questions & 2 mock exams',
      descriptionBn: 'সীমিত মডেল টেস্ট ও প্রশ্ন অনুশীলনের সুবিধা',
      durationDays: 3650,
      priceBdt: 0,
      features: ['2 Full Mock Tests', 'Daily 10 Practice Questions', 'Standard Solution View'],
      isActive: true,
    },
    {
      code: 'MONTHLY',
      nameEn: 'Pro Monthly',
      nameBn: 'প্রো মাসিক',
      descriptionEn: 'Unlimited mock exams, full previous year archive & detailed analytics',
      descriptionBn: 'আনলিমিটেড মডেল টেস্ট, বিগত বছরের প্রশ্ন ব্যাংক ও পূর্ণাঙ্গ বিশ্লেষণ',
      durationDays: 30,
      priceBdt: 299,
      discountPriceBdt: 199,
      features: [
        'Unlimited Mock Exams',
        'All Bangladesh Job & Admission Blueprints',
        'Practice My Mistakes & Bookmark Mode',
        'Subject-wise Analytics & Study Streak',
        'Detailed Explanations & Notes',
      ],
      isActive: true,
    },
    {
      code: 'YEARLY',
      nameEn: 'Ultimate Yearly',
      nameBn: 'আলটিমেট বার্ষিক',
      descriptionEn: 'Full 1-year unlimited access with all question archives & upcoming mock tests',
      descriptionBn: 'সম্পূর্ণ ১ বছরের আনলিমিটেড এক্সেস ও সকল পরীক্ষার পূর্ণ প্রস্তুতি',
      durationDays: 365,
      priceBdt: 1999,
      discountPriceBdt: 1199,
      features: [
        'All Monthly Pro Features',
        '1 Full Year Unlimited Access',
        'All Past BCS & Admission Papers',
        'Priority Question Reports & Review',
        'Leaderboards & PDF Performance Export',
      ],
      isActive: true,
    },
  ];

  for (const plan of plansData) {
    await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      update: plan,
      create: plan,
    });
  }
  console.log('💳 Seeded Subscription Plans.');

  // 5. Create Exam Portals (the cards on the mobile home screen)
  //
  // A portal owns its own questions, years, model tests and syllabus through
  // real foreign keys. Nothing below is sample content: these are the portal
  // definitions themselves, all editable from the App Portals Hub.
  const portalsData: {
    key: string;
    titleEn: string;
    titleBn: string;
    icon: string;
    badge: string;
    color: string;
    group: PortalGroup;
    subjects: string[];
    // Admission units. Each one is a separate scope: its own questions,
    // papers and syllabus. Portals without units leave this empty.
    units?: { key: string; titleEn: string; titleBn: string; badge?: string }[];
  }[] = [
    {
      key: 'Medical & Dental',
      titleEn: 'Medical & Dental',
      titleBn: 'মেডিকেল ও ডেন্টাল',
      icon: '🩺',
      badge: 'MBBS/BDS',
      color: 'bg-rose-50 border-rose-200 text-rose-800',
      group: PortalGroup.UNIVERSITY,
      subjects: ['BIOLOGY', 'CHEMISTRY', 'PHYSICS', 'ENGLISH', 'GK'],
      // MBBS and BDS are separate admissions with their own papers, so they are
      // units of this portal rather than one merged bank.
      units: [
        { key: 'MBBS', titleEn: 'Medical (MBBS)', titleBn: 'মেডিকেল', badge: 'এমবিবিএস' },
        { key: 'BDS', titleEn: 'Dental (BDS)', titleBn: 'ডেন্টাল', badge: 'বিডিএস' },
      ],
    },
    {
      key: 'DU',
      titleEn: 'DU',
      titleBn: 'ঢাকা বিশ্ববিদ্যালয়',
      icon: '🏛️',
      badge: 'ক, খ, গ, ঘ ইউনিট',
      color: 'bg-blue-50 border-blue-200 text-blue-800',
      group: PortalGroup.UNIVERSITY,
      subjects: ['BANGLA', 'ENGLISH', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'MATH_MENTAL', 'BD_AFFAIRS', 'INT_AFFAIRS', 'ICT'],
      units: [
        { key: 'KA', titleEn: 'Ka Unit', titleBn: 'ক ইউনিট', badge: 'বিজ্ঞান' },
        { key: 'KHA', titleEn: 'Kha Unit', titleBn: 'খ ইউনিট', badge: 'কলা ও মানবিক' },
        { key: 'GA', titleEn: 'Ga Unit', titleBn: 'গ ইউনিট', badge: 'ব্যবসায় শিক্ষা' },
        { key: 'GHA', titleEn: 'Gha Unit', titleBn: 'ঘ ইউনিট', badge: 'সমন্বিত' },
      ],
    },
    {
      key: 'GST',
      titleEn: 'GST',
      titleBn: 'জিএসটি গুচ্ছ ভর্তি',
      icon: '🧪',
      badge: '২৪ বিশ্ববিদ্যালয়',
      color: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      group: PortalGroup.UNIVERSITY,
      subjects: ['BANGLA', 'ENGLISH', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'MATH_MENTAL', 'ICT'],
    },
    {
      key: 'JU',
      titleEn: 'JU',
      titleBn: 'জাহাঙ্গীরনগর',
      icon: '🌲',
      badge: 'A, B, C, D, E',
      color: 'bg-amber-50 border-amber-200 text-amber-800',
      group: PortalGroup.UNIVERSITY,
      subjects: ['BANGLA', 'ENGLISH', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'MATH_MENTAL', 'BD_AFFAIRS', 'INT_AFFAIRS'],
      units: [
        { key: 'A', titleEn: 'A Unit', titleBn: 'এ ইউনিট', badge: 'গাণিতিক ও পদার্থ বিজ্ঞান' },
        { key: 'B', titleEn: 'B Unit', titleBn: 'বি ইউনিট', badge: 'জীববিজ্ঞান' },
        { key: 'C', titleEn: 'C Unit', titleBn: 'সি ইউনিট', badge: 'কলা ও মানবিক' },
        { key: 'D', titleEn: 'D Unit', titleBn: 'ডি ইউনিট', badge: 'সামাজিক বিজ্ঞান' },
        { key: 'E', titleEn: 'E Unit', titleBn: 'ই ইউনিট', badge: 'ব্যবসায় শিক্ষা' },
      ],
    },
    {
      key: 'RU',
      titleEn: 'RU',
      titleBn: 'রাজশাহী বিশ্ববিদ্যালয়',
      icon: '🌴',
      badge: 'A, B, C ইউনিট',
      color: 'bg-cyan-50 border-cyan-200 text-cyan-800',
      group: PortalGroup.UNIVERSITY,
      subjects: ['BANGLA', 'ENGLISH', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'MATH_MENTAL', 'BD_AFFAIRS', 'INT_AFFAIRS'],
      units: [
        { key: 'A', titleEn: 'A Unit', titleBn: 'এ ইউনিট', badge: 'বিজ্ঞান' },
        { key: 'B', titleEn: 'B Unit', titleBn: 'বি ইউনিট', badge: 'কলা ও মানবিক' },
        { key: 'C', titleEn: 'C Unit', titleBn: 'সি ইউনিট', badge: 'ব্যবসায় শিক্ষা' },
      ],
    },
    {
      key: 'CU',
      titleEn: 'CU',
      titleBn: 'চট্টগ্রাম বিশ্ববিদ্যালয়',
      icon: '🌊',
      badge: 'A, B, C, D ইউনিট',
      color: 'bg-indigo-50 border-indigo-200 text-indigo-800',
      group: PortalGroup.UNIVERSITY,
      subjects: ['BANGLA', 'ENGLISH', 'PHYSICS', 'CHEMISTRY', 'BIOLOGY', 'MATH_MENTAL', 'BD_AFFAIRS', 'INT_AFFAIRS'],
      units: [
        { key: 'A', titleEn: 'A Unit', titleBn: 'এ ইউনিট', badge: 'বিজ্ঞান' },
        { key: 'B', titleEn: 'B Unit', titleBn: 'বি ইউনিট', badge: 'কলা ও মানবিক' },
        { key: 'C', titleEn: 'C Unit', titleBn: 'সি ইউনিট', badge: 'ব্যবসায় শিক্ষা' },
        { key: 'D', titleEn: 'D Unit', titleBn: 'ডি ইউনিট', badge: 'সমন্বিত' },
      ],
    },
    {
      key: 'Agriculture',
      titleEn: 'Agriculture',
      titleBn: 'কৃষি গুচ্ছ ভর্তি',
      icon: '🌾',
      badge: '৯ কৃষি বিশ্ববিদ্যালয়',
      color: 'bg-lime-50 border-lime-200 text-lime-800',
      group: PortalGroup.UNIVERSITY,
      subjects: ['BIOLOGY', 'CHEMISTRY', 'PHYSICS', 'MATH_MENTAL', 'ENGLISH'],
    },
    {
      key: 'CKRUET',
      titleEn: 'CKRUET',
      titleBn: 'ইঞ্জিনিয়ারিং গুচ্ছ',
      icon: '🔬',
      badge: 'CUET, KUET, RUET',
      color: 'bg-teal-50 border-teal-200 text-teal-800',
      group: PortalGroup.UNIVERSITY,
      subjects: ['PHYSICS', 'CHEMISTRY', 'MATH_MENTAL', 'ENGLISH'],
    },
    {
      key: 'BCS',
      titleEn: 'BCS Preliminary',
      titleBn: 'বিসিএস প্রিলিমিনারি',
      icon: '🎖️',
      badge: '46th & 47th BCS',
      color: 'bg-emerald-50 border-emerald-200 text-emerald-800',
      group: PortalGroup.JOBS,
      subjects: ['BANGLA', 'ENGLISH', 'BD_AFFAIRS', 'INT_AFFAIRS', 'MATH_MENTAL', 'SCIENCE', 'ICT', 'GK'],
    },
    {
      key: 'NTRCA',
      titleEn: 'NTRCA',
      titleBn: 'শিক্ষক নিবন্ধন',
      icon: '👨‍🏫',
      badge: '১৮তম ও ১৯তম শিক্ষক',
      color: 'bg-blue-50 border-blue-200 text-blue-800',
      group: PortalGroup.JOBS,
      subjects: ['BANGLA', 'ENGLISH', 'MATH_MENTAL', 'BD_AFFAIRS', 'INT_AFFAIRS', 'SCIENCE'],
    },
    {
      key: 'Primary',
      titleEn: 'Primary Teacher',
      titleBn: 'প্রাথমিক সহকারী শিক্ষক',
      icon: '🏫',
      badge: 'সহকারী শিক্ষক নিয়োগ',
      color: 'bg-amber-50 border-amber-200 text-amber-800',
      group: PortalGroup.JOBS,
      subjects: ['BANGLA', 'ENGLISH', 'MATH_MENTAL', 'BD_AFFAIRS', 'INT_AFFAIRS', 'SCIENCE'],
    },
    {
      key: 'Bank',
      titleEn: 'Bank Recruitment',
      titleBn: 'ব্যাংক জবস',
      icon: '🏦',
      badge: 'Senior Officer / Cash',
      color: 'bg-violet-50 border-violet-200 text-violet-800',
      group: PortalGroup.JOBS,
      subjects: ['BANGLA', 'ENGLISH', 'MATH_MENTAL', 'BD_AFFAIRS', 'INT_AFFAIRS', 'ICT'],
    },
    {
      key: 'Govt',
      titleEn: 'Govt Jobs (10-20th)',
      titleBn: 'অন্যান্য সরকারি চাকরি',
      icon: '📑',
      badge: 'মন্ত্রণালয় ও অধিদপ্তর',
      color: 'bg-slate-100 border-slate-200 text-slate-800',
      group: PortalGroup.JOBS,
      subjects: ['BANGLA', 'ENGLISH', 'MATH_MENTAL', 'BD_AFFAIRS', 'INT_AFFAIRS', 'SCIENCE', 'ICT', 'GK'],
    },
  ];

  let universityOrder = 0;
  let jobOrder = 0;
  let unitTotal = 0;
  let subjectTotal = 0;
  let topicTotal = 0;

  for (const def of portalsData) {
    const sortOrder = def.group === PortalGroup.UNIVERSITY ? universityOrder++ : jobOrder++;

    const payload = {
      titleEn: def.titleEn,
      titleBn: def.titleBn,
      icon: def.icon,
      badge: def.badge,
      color: def.color,
      group: def.group,
      sortOrder,
    };

    const portal = await prisma.portal.upsert({
      where: { key: def.key },
      update: payload,
      create: { key: def.key, ...payload },
    });

    // Admission units, each its own scope for questions, papers and subjects.
    for (let u = 0; u < (def.units || []).length; u++) {
      const unitDef = def.units![u];

      const existingUnit = await prisma.portalUnit.findFirst({
        where: { portalId: portal.id, key: unitDef.key },
      });

      const unitPayload = {
        titleEn: unitDef.titleEn,
        titleBn: unitDef.titleBn,
        badge: unitDef.badge || null,
        sortOrder: u,
      };

      if (existingUnit) {
        await prisma.portalUnit.update({ where: { id: existingUnit.id }, data: unitPayload });
      } else {
        await prisma.portalUnit.create({
          data: { portalId: portal.id, key: unitDef.key, ...unitPayload },
        });
      }
    }

    unitTotal += (def.units || []).length;

    // Every scope owns its subjects outright. A portal with units gets one
    // syllabus per unit; a portal without units gets one at portal level.
    const createdUnits = await prisma.portalUnit.findMany({
      where: { portalId: portal.id },
      orderBy: { sortOrder: 'asc' },
    });

    const scopes: { unitId: string | null; unitScope: string }[] =
      createdUnits.length > 0
        ? createdUnits.map((u) => ({ unitId: u.id, unitScope: u.id }))
        : [{ unitId: null, unitScope: '' }];

    for (const scope of scopes) {
      for (let i = 0; i < def.subjects.length; i++) {
        const template = subjectTemplates[def.subjects[i]];
        if (!template) continue;

        const existing = await prisma.subject.findFirst({
          where: { portalId: portal.id, unitScope: scope.unitScope, code: template.code },
        });

        const subject = existing
          ? await prisma.subject.update({
              where: { id: existing.id },
              data: {
                titleEn: template.titleEn,
                titleBn: template.titleBn,
                icon: template.icon,
                sortOrder: i,
              },
            })
          : await prisma.subject.create({
              data: {
                portalId: portal.id,
                unitId: scope.unitId,
                unitScope: scope.unitScope,
                titleEn: template.titleEn,
                titleBn: template.titleBn,
                code: template.code,
                icon: template.icon,
                sortOrder: i,
              },
            });

        subjectTotal++;

        // Chapters belong to this copy of the subject only.
        for (const t of template.topics) {
          const existingTopic = await prisma.topic.findFirst({
            where: { subjectId: subject.id, titleEn: t.titleEn },
          });

          if (existingTopic) {
            await prisma.topic.update({
              where: { id: existingTopic.id },
              data: { titleBn: t.titleBn },
            });
          } else {
            await prisma.topic.create({
              data: { subjectId: subject.id, titleEn: t.titleEn, titleBn: t.titleBn },
            });
          }
          topicTotal++;
        }
      }
    }
  }

  console.log(
    `\u{1F393} Seeded ${portalsData.length} Exam Portals, ${unitTotal} admission units, ` +
      `${subjectTotal} owned subjects and ${topicTotal} chapters.`,
  );
  console.log('');
  console.log('No exams, question papers or attempts are seeded.');
  console.log('Add question paper years and MCQs from the Admin Dashboard under');
  console.log('App Portals Hub - each one is filed against its own portal.');
  console.log('ExamBondhuBD Database Seeding Completed Successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
