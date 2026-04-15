/**
 * Merchant Cache — zero-cost re-categorization
 * Stores category+subcategory keyed by normalized merchant name.
 * Once a merchant is categorized (by AI or user), it's cached forever.
 * Subsequent statements/scans check this first — no AI needed.
 */
import { db } from '../firebase';
import { doc, getDoc, setDoc, writeBatch, Timestamp } from 'firebase/firestore';

export interface MerchantEntry {
  category: string;
  subcategory?: string;
  isSubscription: boolean;
  isIncome: boolean;
  incomeType?: string;
  confirmedByUser: boolean;
  useCount: number;
  lastSeen: Timestamp;
}

/** Normalize merchant name to a stable cache key */
export const normalizeMerchant = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\s+(pty|ltd|llc|inc|co|au|australia|international|group)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 40);

/** Read multiple merchants from cache in one batch */
export const getMerchantCache = async (
  householdId: string,
  merchants: string[]
): Promise<Record<string, MerchantEntry>> => {
  const result: Record<string, MerchantEntry> = {};
  const keys = [...new Set(merchants.map(normalizeMerchant))];

  // Firestore getDoc is fast for individual docs; batch if needed
  await Promise.all(
    keys.map(async (key) => {
      if (!key) return;
      try {
        const snap = await getDoc(doc(db, `households/${householdId}/merchantCache`, key));
        if (snap.exists()) result[key] = snap.data() as MerchantEntry;
      } catch { /* cache miss is fine */ }
    })
  );
  return result;
};

/** Write a batch of merchant entries to cache */
export const saveMerchantCache = async (
  householdId: string,
  entries: Array<{ merchant: string; entry: Partial<MerchantEntry> }>
): Promise<void> => {
  const batch = writeBatch(db);
  for (const { merchant, entry } of entries) {
    const key = normalizeMerchant(merchant);
    if (!key) continue;
    const ref = doc(db, `households/${householdId}/merchantCache`, key);
    batch.set(ref, {
      ...entry,
      lastSeen: Timestamp.now(),
      useCount: (entry.useCount || 0) + 1,
    }, { merge: true });
  }
  await batch.commit();
};

/** Update a single merchant entry (called when user confirms a category) */
export const confirmMerchantCategory = async (
  householdId: string,
  merchant: string,
  category: string,
  isSubscription = false
): Promise<void> => {
  const key = normalizeMerchant(merchant);
  if (!key) return;
  await setDoc(
    doc(db, `households/${householdId}/merchantCache`, key),
    { category, isSubscription, confirmedByUser: true, lastSeen: Timestamp.now() },
    { merge: true }
  );
};
