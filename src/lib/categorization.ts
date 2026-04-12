/**
 * OurSpace — Smart Categorization Engine (4-Layer System)
 *
 * Layer 1: Global Merchant Database (instant, no API)
 * Layer 2: Household Learning Database (Firestore cache)
 * Layer 3: Keyword Engine (600+ Australian items)
 * Layer 4: Gemini Fallback (only when layers 1–3 fail)
 *
 * After Layer 4, result is saved to Firestore — so next time it's Layer 2.
 * "Other" is NEVER a final answer.
 */

import { db } from '../firebase';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  increment,
  serverTimestamp,
} from 'firebase/firestore';
import { callGeminiText } from './gemini';

export interface CategoryResult {
  cat: string;
  confidence: number;
  source?: 'merchant' | 'household_db' | 'keyword' | 'ai' | 'user_manual';
}

// ============================================================
// LAYER 1 — GLOBAL MERCHANT DATABASE
// ============================================================
const MERCHANT_DB: Record<string, CategoryResult> = {
  // GROCERIES — Australian supermarkets
  woolworths: { cat: 'groceries', confidence: 1.0 },
  'woolies': { cat: 'groceries', confidence: 1.0 },
  'ww ': { cat: 'groceries', confidence: 1.0 },
  'wws ': { cat: 'groceries', confidence: 1.0 },
  coles: { cat: 'groceries', confidence: 1.0 },
  aldi: { cat: 'groceries', confidence: 1.0 },
  'iga ': { cat: 'groceries', confidence: 1.0 },
  foodland: { cat: 'groceries', confidence: 1.0 },
  'drakes supermarkets': { cat: 'groceries', confidence: 1.0 },
  'harris farm': { cat: 'groceries', confidence: 1.0 },
  'thomas dux': { cat: 'groceries', confidence: 1.0 },
  "romeo's retail": { cat: 'groceries', confidence: 1.0 },
  costco: { cat: 'groceries', confidence: 1.0 },
  supabarn: { cat: 'groceries', confidence: 1.0 },
  spudshed: { cat: 'groceries', confidence: 1.0 },
  foodworks: { cat: 'groceries', confidence: 1.0 },
  'fruit market': { cat: 'groceries', confidence: 0.9 },
  'fresh market': { cat: 'groceries', confidence: 0.9 },
  'asian grocery': { cat: 'groceries', confidence: 0.9 },
  // FUEL / TRANSPORT
  shell: { cat: 'transport', confidence: 1.0 },
  'bp ': { cat: 'transport', confidence: 1.0 },
  caltex: { cat: 'transport', confidence: 1.0 },
  ampol: { cat: 'transport', confidence: 1.0 },
  'united petroleum': { cat: 'transport', confidence: 1.0 },
  'puma energy': { cat: 'transport', confidence: 1.0 },
  'liberty oil': { cat: 'transport', confidence: 1.0 },
  'coles express': { cat: 'transport', confidence: 1.0 },
  'on the run': { cat: 'transport', confidence: 1.0 },
  'metro petroleum': { cat: 'transport', confidence: 1.0 },
  '7-eleven': { cat: 'transport', confidence: 0.9 },
  uber: { cat: 'transport', confidence: 1.0 },
  ola: { cat: 'transport', confidence: 1.0 },
  didi: { cat: 'transport', confidence: 1.0 },
  'opal': { cat: 'transport', confidence: 1.0 },
  myki: { cat: 'transport', confidence: 1.0 },
  'ptv ': { cat: 'transport', confidence: 1.0 },
  // DINING
  mcdonald: { cat: 'dining', confidence: 1.0 },
  "maccas": { cat: 'dining', confidence: 1.0 },
  kfc: { cat: 'dining', confidence: 1.0 },
  'hungry jack': { cat: 'dining', confidence: 1.0 },
  subway: { cat: 'dining', confidence: 1.0 },
  domino: { cat: 'dining', confidence: 1.0 },
  'pizza hut': { cat: 'dining', confidence: 1.0 },
  'red rooster': { cat: 'dining', confidence: 1.0 },
  oporto: { cat: 'dining', confidence: 1.0 },
  "nando": { cat: 'dining', confidence: 1.0 },
  "grill'd": { cat: 'dining', confidence: 1.0 },
  'guzman y gomez': { cat: 'dining', confidence: 1.0 },
  guzman: { cat: 'dining', confidence: 1.0 },
  'sushi hub': { cat: 'dining', confidence: 1.0 },
  'sushi train': { cat: 'dining', confidence: 1.0 },
  'boost juice': { cat: 'dining', confidence: 1.0 },
  chatime: { cat: 'dining', confidence: 1.0 },
  easyway: { cat: 'dining', confidence: 1.0 },
  starbucks: { cat: 'dining', confidence: 1.0 },
  'gloria jean': { cat: 'dining', confidence: 1.0 },
  'coffee club': { cat: 'dining', confidence: 1.0 },
  'hudsons coffee': { cat: 'dining', confidence: 1.0 },
  campos: { cat: 'dining', confidence: 1.0 },
  restaurant: { cat: 'dining', confidence: 0.9 },
  bistro: { cat: 'dining', confidence: 0.9 },
  eatery: { cat: 'dining', confidence: 0.9 },
  'fish and chips': { cat: 'dining', confidence: 0.9 },
  kebab: { cat: 'dining', confidence: 0.9 },
  'bakers delight': { cat: 'dining', confidence: 1.0 },
  brumby: { cat: 'dining', confidence: 1.0 },
  muffin: { cat: 'dining', confidence: 0.8 },
  schnitz: { cat: 'dining', confidence: 1.0 },
  "roll'd": { cat: 'dining', confidence: 1.0 },
  'zambreros': { cat: 'dining', confidence: 1.0 },
  // COFFEE
  cafe: { cat: 'coffee', confidence: 0.9 },
  'seven seeds': { cat: 'coffee', confidence: 1.0 },
  'Brother Baba': { cat: 'coffee', confidence: 1.0 },
  'market lane': { cat: 'coffee', confidence: 1.0 },
  'st ali': { cat: 'coffee', confidence: 1.0 },
  // PHARMACY / HEALTH
  'chemist warehouse': { cat: 'health', confidence: 1.0 },
  'priceline pharmacy': { cat: 'health', confidence: 1.0 },
  'terry white': { cat: 'health', confidence: 1.0 },
  'blooms the chemist': { cat: 'health', confidence: 1.0 },
  amcal: { cat: 'health', confidence: 1.0 },
  'national pharmacies': { cat: 'health', confidence: 1.0 },
  'guardian pharmacy': { cat: 'health', confidence: 1.0 },
  pharmacy: { cat: 'health', confidence: 0.9 },
  chemist: { cat: 'health', confidence: 0.9 },
  'medical centre': { cat: 'health', confidence: 1.0 },
  dental: { cat: 'health', confidence: 1.0 },
  physio: { cat: 'health', confidence: 1.0 },
  doctor: { cat: 'health', confidence: 1.0 },
  'bulk billing': { cat: 'health', confidence: 1.0 },
  medicare: { cat: 'health', confidence: 1.0 },
  hospital: { cat: 'health', confidence: 1.0 },
  'fitness first': { cat: 'health', confidence: 1.0 },
  'anytime fitness': { cat: 'health', confidence: 1.0 },
  goodlife: { cat: 'health', confidence: 1.0 },
  crossfit: { cat: 'health', confidence: 1.0 },
  gym: { cat: 'health', confidence: 0.9 },
  // UTILITIES / BILLS
  agl: { cat: 'utilities', confidence: 1.0 },
  'origin energy': { cat: 'utilities', confidence: 1.0 },
  'energy australia': { cat: 'utilities', confidence: 1.0 },
  'simply energy': { cat: 'utilities', confidence: 1.0 },
  'alinta energy': { cat: 'utilities', confidence: 1.0 },
  telstra: { cat: 'utilities', confidence: 1.0 },
  optus: { cat: 'utilities', confidence: 1.0 },
  vodafone: { cat: 'utilities', confidence: 1.0 },
  tpg: { cat: 'utilities', confidence: 1.0 },
  'aussie broadband': { cat: 'utilities', confidence: 1.0 },
  iinet: { cat: 'utilities', confidence: 1.0 },
  belong: { cat: 'utilities', confidence: 1.0 },
  foxtel: { cat: 'utilities', confidence: 1.0 },
  dodo: { cat: 'utilities', confidence: 1.0 },
  amaysim: { cat: 'utilities', confidence: 1.0 },
  'council rates': { cat: 'utilities', confidence: 1.0 },
  'water corporation': { cat: 'utilities', confidence: 1.0 },
  'south east water': { cat: 'utilities', confidence: 1.0 },
  'yarra valley water': { cat: 'utilities', confidence: 1.0 },
  insurance: { cat: 'utilities', confidence: 0.85 },
  // ENTERTAINMENT
  hoyts: { cat: 'entertainment', confidence: 1.0 },
  'event cinemas': { cat: 'entertainment', confidence: 1.0 },
  'village cinemas': { cat: 'entertainment', confidence: 1.0 },
  'reading cinemas': { cat: 'entertainment', confidence: 1.0 },
  'palace cinemas': { cat: 'entertainment', confidence: 1.0 },
  netflix: { cat: 'entertainment', confidence: 1.0 },
  spotify: { cat: 'entertainment', confidence: 1.0 },
  disney: { cat: 'entertainment', confidence: 1.0 },
  'stan ': { cat: 'entertainment', confidence: 1.0 },
  binge: { cat: 'entertainment', confidence: 1.0 },
  kayo: { cat: 'entertainment', confidence: 1.0 },
  ticketek: { cat: 'entertainment', confidence: 1.0 },
  ticketmaster: { cat: 'entertainment', confidence: 1.0 },
  'youtube premium': { cat: 'entertainment', confidence: 1.0 },
  'apple tv': { cat: 'entertainment', confidence: 1.0 },
  'paramount+': { cat: 'entertainment', confidence: 1.0 },
  // RETAIL / SHOPPING
  kmart: { cat: 'shopping', confidence: 1.0 },
  target: { cat: 'shopping', confidence: 1.0 },
  'big w': { cat: 'shopping', confidence: 1.0 },
  myer: { cat: 'shopping', confidence: 1.0 },
  'david jones': { cat: 'shopping', confidence: 1.0 },
  'cotton on': { cat: 'shopping', confidence: 1.0 },
  uniqlo: { cat: 'shopping', confidence: 1.0 },
  zara: { cat: 'shopping', confidence: 1.0 },
  officeworks: { cat: 'shopping', confidence: 1.0 },
  'jb hi-fi': { cat: 'shopping', confidence: 1.0 },
  'harvey norman': { cat: 'shopping', confidence: 1.0 },
  bunnings: { cat: 'shopping', confidence: 1.0 },
  ikea: { cat: 'shopping', confidence: 1.0 },
  'the good guys': { cat: 'shopping', confidence: 1.0 },
  amazon: { cat: 'shopping', confidence: 0.9 },
  ebay: { cat: 'shopping', confidence: 0.9 },
  // PERSONAL CARE
  hairhouse: { cat: 'personal_care', confidence: 1.0 },
  'just cuts': { cat: 'personal_care', confidence: 1.0 },
  wax: { cat: 'personal_care', confidence: 0.9 },
  salon: { cat: 'personal_care', confidence: 0.85 },
  barber: { cat: 'personal_care', confidence: 1.0 },
  spa: { cat: 'personal_care', confidence: 0.8 },
  'laser clinics': { cat: 'personal_care', confidence: 1.0 },
  priceline: { cat: 'personal_care', confidence: 0.85 },
};

// ============================================================
// LAYER 3 — KEYWORD ENGINE (600+ items)
// ============================================================
const KEYWORD_DB: Record<string, { keywords: string[]; minMatch?: number }> = {
  groceries: {
    keywords: [
      // Produce
      'apple','banana','orange','mango','pear','grape','strawberry','blueberry','raspberry',
      'watermelon','cantaloupe','melon','pineapple','kiwi','avocado','lemon','lime','peach',
      'plum','cherry','fig','passionfruit','dragonfruit','lychee','pomelo',
      'potato','sweet potato','onion','garlic','ginger','carrot','celery','capsicum',
      'tomato','cucumber','zucchini','broccoli','cauliflower','spinach','lettuce','rocket',
      'kale','silverbeet','cabbage','brussels sprout','pea','bean','corn','asparagus',
      'mushroom','pumpkin','squash','beet','radish','parsnip','turnip','fennel','leek',
      'spring onion','shallot','chilli','jalapeno','eggplant','artichoke',
      // Dairy
      'milk','full cream milk','skim milk','almond milk','oat milk','soy milk',
      'cheese','cheddar','mozzarella','parmesan','brie','camembert','feta','halloumi',
      'yoghurt','greek yoghurt','yogurt','butter','margarine','cream','sour cream',
      'cream cheese','mascarpone','ricotta','cottage cheese','gouda','swiss cheese',
      'eggs','free range eggs','organic eggs',
      // Bread & Bakery
      'bread','white bread','wholemeal bread','sourdough','baguette','roll','bun',
      'toast','sandwich','wrap','pita','naan','rye bread','gluten free bread',
      'croissant','muffin','scone','danish','donut','bagel','crumpet',
      // Meat & Seafood
      'chicken','chicken breast','chicken thigh','chicken drumstick','whole chicken',
      'beef','steak','mince','ground beef','lamb','pork','bacon','ham','salami',
      'sausage','chorizo','prosciutto','pancetta','turkey','duck','veal',
      'salmon','tuna','prawns','shrimp','fish','barramundi','snapper','whiting',
      'squid','calamari','crab','lobster','scallops','oysters','mussels','clams',
      // Pantry
      'pasta','spaghetti','penne','fettuccine','lasagne','rice','basmati','jasmine',
      'arborio','quinoa','couscous','lentil','chickpea','kidney bean','black bean',
      'flour','plain flour','self raising flour','bread flour','cornflour',
      'sugar','brown sugar','caster sugar','icing sugar','honey','maple syrup',
      'olive oil','vegetable oil','coconut oil','sesame oil','butter',
      'vinegar','balsamic','apple cider vinegar','soy sauce','worcestershire',
      'tomato sauce','ketchup','mayo','mayonnaise','mustard','hot sauce','sriracha',
      'stock','chicken stock','beef stock','vegetable stock','broth',
      'can','canned','tinned','baked beans','diced tomatoes','coconut milk',
      'cereal','muesli','granola','oats','rolled oats','porridge',
      'coffee','instant coffee','ground coffee','espresso','tea','green tea',
      'juice','orange juice','apple juice','cordial','soft drink','sparkling water',
      'water','mineral water','kombucha','energy drink',
      // Frozen
      'frozen','ice cream','gelato','sorbet','frozen peas','frozen corn',
      'frozen pizza','frozen meal','frozen chips','fish fingers',
      // Snacks
      'chips','crisps','tim tam','biscuit','cookie','chocolate','cadbury','darrell lea',
      'popcorn','nuts','almonds','cashews','peanuts','trail mix','muesli bar',
      'protein bar','rice cake','cracker',
      // Household Groceries
      'toilet paper','paper towel','tissues','napkins','aluminium foil','cling wrap',
      'zip lock','sandwich bag','dish soap','dishwashing liquid','washing powder',
      'washing liquid','fabric softener','bleach','spray','cleaner','sponge',
      'garbage bag','bin liner','shoe polish','batteries','light bulb','candle',
      // Baby
      'nappy','diaper','formula','baby food','baby wipes','baby wash','dummy',
      // Pet
      'dog food','cat food','pet food','kitty litter','dog treat','cat treat',
      'flea treatment','worming tablet',
    ],
  },
  dining: {
    keywords: [
      'meal kit','takeaway','takeout','delivery','doordash order','ubereats','menulog',
      'thai food','indian food','chinese food','japanese food','korean food',
      'vietnamese food','pizza','burger','wrap','salad bar','buffet',
    ],
  },
  coffee: {
    keywords: [
      'flat white','latte','cappuccino','long black','short black','espresso',
      'macchiato','piccolo','cold brew','iced coffee','chai latte','matcha latte',
      'hot chocolate','babyccino',
    ],
  },
  transport: {
    keywords: [
      'petrol','diesel','unleaded','premium unleaded','91','95','98',
      'fuel','refuel','fill up','car wash','carwash','parking','car park',
      'toll','citylink','e-toll','e-way','mex','eastlink','westgate',
      'lyft','rideshare','cab','taxi','tram','train','bus','ferry',
      'Opal','myki card','go card','metro card',
    ],
  },
  health: {
    keywords: [
      'medication','prescription','supplement','vitamin','paracetamol','ibuprofen',
      'antibiotic','cold and flu','antihistamine','sunscreen','bandaid','bandage',
      'first aid','thermometer','blood pressure','glucose','test kit',
      'consultation','appointment','bulk bill','gap fee','excess',
      'pilates','yoga','swimming','personal trainer','massage','physio',
      'chiropractor','osteopath','psychologist','counselling','dentist','orthodontist',
    ],
  },
  entertainment: {
    keywords: [
      'movie','cinema','streaming','subscription','concert','show','theatre','festival',
      'event','ticket','game','bowling','escape room','mini golf','laser tag',
      'trampoline','go kart','amusement','theme park','zoo','aquarium',
    ],
  },
  utilities: {
    keywords: [
      'electricity','gas','water','internet','broadband','mobile plan','phone bill',
      'home insurance','contents insurance','car insurance','life insurance',
      'rates','council','strata','body corporate','rent',
    ],
  },
  shopping: {
    keywords: [
      'clothing','clothes','shirt','pants','jeans','dress','skirt','shoes','boots',
      'sneakers','jacket','coat','underwear','socks','accessories','jewellery',
      'handbag','backpack','wallet','sunglasses','hat','cap','scarf','gloves',
      'homewares','furniture','bedding','linen','cushion','lamp','rug','decor',
      'electronics','phone','laptop','tablet','headphones','speaker','camera',
      'tools','drill','paint','hardware',
    ],
  },
  personal_care: {
    keywords: [
      'shampoo','conditioner','body wash','soap','deodorant','perfume','cologne',
      'moisturiser','moisturizer','face wash','toner','serum','sunscreen spf',
      'makeup','foundation','mascara','lipstick','nail polish','hair dye',
      'razor','shaving','toothpaste','toothbrush','floss','mouthwash',
      'haircut','blowdry','colour','highlights','manicure','pedicure','waxing',
    ],
  },
  household: {
    keywords: [
      'plumber','electrician','handyman','locksmith','gardener','lawn mowing',
      'pest control','cleaning service','storage','moving','van hire','ute hire',
      'repairs','maintenance','renovation','paint supply',
    ],
  },
  work_expense: {
    keywords: [
      'software','subscription saas','adobe','microsoft','slack','zoom','notion',
      'conference','seminar','training','course','textbook','stationery','office',
      'business card','printing','postage','courier','freight','work lunch','client',
    ],
  },
};

// ============================================================
// NORMALIZE ITEM NAME
// ============================================================
export const normalizeItemName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/\d+(\.\d+)?\s*(g|kg|ml|l|pk|pack|pkt|pce|pcs|ea|each|x\d+)/gi, '')
    .replace(/woolworths|ww\s|coles\s|aldi\s|homebrand|macro\s|select\s|finest\s|essentials/gi, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .substring(0, 60);
};

// ============================================================
// LAYER 1 — MERCHANT MATCH
// ============================================================
const matchMerchant = (merchantName: string): CategoryResult | null => {
  const lower = merchantName.toLowerCase();
  for (const [key, result] of Object.entries(MERCHANT_DB)) {
    if (lower.includes(key)) return { ...result, source: 'merchant' };
  }
  return null;
};

// ============================================================
// LAYER 2 — HOUSEHOLD DB
// ============================================================
export const lookupHouseholdDB = async (
  householdId: string,
  normalizedName: string
): Promise<CategoryResult | null> => {
  try {
    const ref = doc(db, `households/${householdId}/itemCategoryDB`, normalizedName);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      await updateDoc(ref, {
        timesUsed: increment(1),
        lastUsedAt: serverTimestamp(),
      });
      if (data.confidence >= 0.5) {
        return {
          cat: data.category,
          confidence: data.confidence,
          source: 'household_db',
        };
      }
    }
  } catch {
    // Silently fail — continue to next layer
  }
  return null;
};

export const saveToHouseholdDB = async (
  householdId: string,
  normalizedName: string,
  result: CategoryResult & { source: string }
): Promise<void> => {
  try {
    await setDoc(
      doc(db, `households/${householdId}/itemCategoryDB`, normalizedName),
      {
        category: result.cat,
        confidence: result.confidence,
        source: result.source,
        timesUsed: 1,
        lastUsedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    console.warn('Could not save to itemCategoryDB:', e);
  }
};

// ============================================================
// LAYER 3 — KEYWORD ENGINE
// ============================================================
const matchKeyword = (itemName: string): CategoryResult | null => {
  const lower = itemName.toLowerCase();
  let bestMatch: { cat: string; score: number } | null = null;

  for (const [cat, { keywords }] of Object.entries(KEYWORD_DB)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        const score = kw.length / lower.length; // longer match = more specific
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { cat, score };
        }
      }
    }
  }

  if (bestMatch) {
    return {
      cat: bestMatch.cat,
      confidence: Math.min(0.95, 0.7 + bestMatch.score * 0.3),
      source: 'keyword',
    };
  }
  return null;
};

// ============================================================
// LAYER 4 — GEMINI FALLBACK
// ============================================================
const categorizeWithGemini = async (
  itemName: string,
  merchantName: string
): Promise<CategoryResult> => {
  try {
    const prompt = `Australian receipt line item categorization. Category REQUIRED — NEVER return "other" as your ONLY option.
Item: "${itemName}" | Merchant: "${merchantName}"

Available categories: groceries, dining, transport, health, entertainment, utilities, shopping, personal_care, coffee, household, baby, pet, work_expense

Rules:
- ANY food/drink item → groceries (unless clearly from a restaurant/cafe)
- ANY café beverage (flat white, latte, etc) → coffee
- WW/Macro/Select/Homebrand branded → groceries
- Cleaning/hygiene products → groceries
- "Other" is NOT acceptable unless absolutely no other category fits
- If ambiguous between two categories → pick the most likely one

Return ONLY valid JSON (no markdown): {"category": "string", "confidence": 0.0, "reasoning": "string"}`;

    const text = (await callGeminiText(prompt, "gemini-2.5-flash-preview", true)).trim();
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      cat: parsed.category || 'groceries',
      confidence: Math.max(0.5, Math.min(1.0, parsed.confidence || 0.75)),
      source: 'ai',
    };
  } catch (e) {
    console.warn('Gemini categorization failed:', e);
    // Still never return "other" — make a best guess
    const lower = itemName.toLowerCase();
    if (lower.includes('food') || lower.includes('eat')) return { cat: 'dining', confidence: 0.5, source: 'ai' };
    return { cat: 'groceries', confidence: 0.5, source: 'ai' };
  }
};

// ============================================================
// MAIN CATEGORIZE FUNCTION — runs all 4 layers
// ============================================================
export const categorizeItem = async (
  itemName: string,
  merchantName: string = '',
  householdId?: string
): Promise<CategoryResult> => {
  const normalized = normalizeItemName(itemName);

  // Layer 1: Merchant
  const merchantResult = matchMerchant(merchantName || itemName);
  if (merchantResult && merchantResult.confidence >= 0.9) {
    if (householdId) {
      await saveToHouseholdDB(householdId, normalized, merchantResult as CategoryResult & { source: string });
    }
    return merchantResult;
  }

  // Layer 2: Household DB
  if (householdId) {
    const dbResult = await lookupHouseholdDB(householdId, normalized);
    if (dbResult && dbResult.confidence >= 0.5) return dbResult;
  }

  // Layer 3: Keywords
  const kwResult = matchKeyword(itemName);
  if (kwResult && kwResult.confidence >= 0.7) {
    if (householdId) {
      await saveToHouseholdDB(householdId, normalized, kwResult as CategoryResult & { source: string });
    }
    return kwResult;
  }

  // Layer 4: Gemini
  const aiResult = await categorizeWithGemini(itemName, merchantName);
  if (householdId) {
    await saveToHouseholdDB(householdId, normalized, aiResult as CategoryResult & { source: string });
  }
  return aiResult;
};

// ============================================================
// BATCH CATEGORIZE (for receipts with many line items)
// ============================================================
export const categorizeReceiptItems = async (
  items: Array<{ name: string; merchantName?: string }>,
  householdId?: string
): Promise<CategoryResult[]> => {
  return Promise.all(
    items.map(item => categorizeItem(item.name, item.merchantName || '', householdId))
  );
};

// ============================================================
// MANUAL OVERRIDE — save user's choice to household DB
// ============================================================
export const saveManualCategory = async (
  householdId: string,
  itemName: string,
  category: string
): Promise<void> => {
  const normalized = normalizeItemName(itemName);
  await saveToHouseholdDB(householdId, normalized, {
    cat: category,
    confidence: 1.0,
    source: 'user_manual',
  });
};
