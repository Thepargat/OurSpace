/**
 * OurSpace — Bank Import Engine
 *
 * Architecture (fully resumable, non-blocking):
 *
 * 1. startBankImport(file)
 *    - Extract all page texts with pdfjs (browser, free, ~1s per page)
 *    - Save ALL page texts to Firestore immediately
 *      → If tab closes now, texts are safe; nothing needs re-uploading
 *    - Create import doc in bankImports/{importId}
 *    - Fire-and-forget processImportInBackground()
 *    - Return importId — caller closes UI immediately
 *
 * 2. processImportInBackground(importId, householdId)
 *    - Reads page texts from Firestore (safe to resume)
 *    - Sends 3 pages of TEXT at a time to Gemini 2.5 Flash
 *    - Saves each batch of transactions to rawTransactions sub-collection
 *    - Tracks processedPages + failedPages per chunk
 *    - On complete → categoriseImport()
 *    - Safe to call multiple times; skips already-processed pages
 *
 * 3. resumeUnfinishedImports(householdId)
 *    - Called on FinancesTab mount
 *    - Finds any import stuck in 'ai_parsing' and resumes it
 *
 * 4. retryFailedPages(importId, householdId)
 *    - User-initiated retry for specific failed page chunks
 *    - Loads page texts from Firestore (no re-upload needed)
 *
 * 5. confirmImportTransactions(importId, householdId, userId, selectedIds)
 *    - Moves selected rawTransactions → expenses / bankTransactions
 *    - Marks import as 'completed'
 */

import {
  db,
} from '../firebase';
import {
  doc, collection, addDoc, updateDoc, setDoc,
  getDocs, getDoc, query, orderBy, serverTimestamp,
  writeBatch, Timestamp,
} from 'firebase/firestore';
import { extractPDFText, batchCategorizeWithCache } from './bankParsers';
import { detectIncomeType } from './cashflow';
import { format } from 'date-fns';

// ── Types ──────────────────────────────────────────────────────────────────

export type ImportStatus =
  | 'extracting'
  | 'ai_parsing'
  | 'categorising'
  | 'needs_review'
  | 'partially_failed'
  | 'completed';

export interface BankImport {
  id: string;
  fileName: string;
  status: ImportStatus;
  totalPages: number;
  processedPages: number[];
  failedPages: number[];
  transactionCount: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

export interface RawImportTx {
  id: string;
  importId: string;
  date: Date;
  description: string;
  cleanDescription: string;
  amount: number;
  type: 'debit' | 'credit';
  category: string;
  subcategory?: string;
  fromCache: boolean;
  needsClarification: boolean;
  pageSource: number;
  status: 'pending_review' | 'confirmed' | 'rejected';
  incomeType?: string | null;
  balance?: number | null;
}

// ── Internal helpers ────────────────────────────────────────────────────────

const parseDate = (str: string): Date => {
  if (!str) return new Date();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str + 'T12:00:00');
    return isNaN(d.getTime()) ? new Date() : d;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date() : d;
};

const cleanDesc = (raw: string): string =>
  raw
    .replace(/eftpos|pos purchase|pos debit|visa purchase|card \d{4,}/gi, '')
    .replace(/\d{6,}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^a-zA-Z]+/, '');

// ── 1. Start import ─────────────────────────────────────────────────────────

/**
 * Upload → extract pages → save to Firestore → start background AI.
 * Returns importId immediately; caller should close the upload UI.
 */
export const startBankImport = async (
  file: File,
  householdId: string,
  userId: string,
  onProgress?: (stage: string, pct: number) => void
): Promise<string> => {
  onProgress?.('Extracting page text…', 10);

  // 1. pdfjs text extraction — sorted by Y/X, proper reading order
  const { pages } = await extractPDFText(file);
  onProgress?.(`${pages.length} pages extracted — saving…`, 50);

  // 2. Create import document
  const importRef = await addDoc(
    collection(db, `households/${householdId}/bankImports`),
    {
      fileName: file.name,
      status: 'ai_parsing' as ImportStatus,
      totalPages: pages.length,
      processedPages: [] as number[],
      failedPages: [] as number[],
      transactionCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: userId,
    }
  );

  // 3. Save ALL page texts to Firestore — enables resume if tab closes
  //    Batches of 20 (Firestore limit is 500 but keep batches manageable)
  const BATCH_SIZE = 20;
  for (let i = 0; i < pages.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    pages.slice(i, i + BATCH_SIZE).forEach((text, j) => {
      const idx = i + j;
      batch.set(
        doc(db, `households/${householdId}/bankImports/${importRef.id}/pages`, String(idx)),
        { text, pageIndex: idx }
      );
    });
    await batch.commit();
  }
  onProgress?.('Saved — AI parsing starting in background…', 90);

  // 4. Fire-and-forget background AI processing
  processImportInBackground(importRef.id, householdId, pages).catch((e) =>
    console.warn('[bankImport] background processing error:', e)
  );

  return importRef.id;
};

// ── 2. Background AI processor ──────────────────────────────────────────────

/**
 * Processes un-parsed pages with Gemini 2.5 Flash (3 pages per call).
 * Safe to call multiple times — skips already-processed pages.
 * pagesArg: pass in-memory pages on first call to avoid a Firestore round-trip.
 */
export const processImportInBackground = async (
  importId: string,
  householdId: string,
  pagesArg?: string[]
): Promise<void> => {
  const importPath = `households/${householdId}/bankImports/${importId}`;

  // Get current state
  const importSnap = await getDoc(doc(db, importPath));
  if (!importSnap.exists()) return;
  const importData = importSnap.data();

  const processedPages: number[] = importData.processedPages ?? [];
  const failedPages: number[] = importData.failedPages ?? [];
  const totalPages: number = importData.totalPages ?? 0;

  // Load page texts (from args if available, else from Firestore)
  let pages: string[] = pagesArg ?? [];
  if (pages.length === 0) {
    const pageDocs = await getDocs(
      collection(db, `${importPath}/pages`)
    );
    pages = new Array(totalPages).fill('');
    pageDocs.forEach((d) => {
      const idx = d.data().pageIndex as number;
      if (idx >= 0 && idx < totalPages) pages[idx] = d.data().text ?? '';
    });
  }

  // Which pages still need processing?
  const toProcess = Array.from({ length: totalPages }, (_, i) => i).filter(
    (i) => !processedPages.includes(i)
  );

  if (toProcess.length === 0) {
    await categoriseImport(importId, householdId);
    return;
  }

  const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey) {
    await updateDoc(doc(db, importPath), {
      status: 'partially_failed' as ImportStatus,
      failedPages: toProcess,
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const CHUNK = 3;
  const newProcessed = [...processedPages];
  const newFailed = [...failedPages];

  for (let i = 0; i < toProcess.length; i += CHUNK) {
    const chunkIndices = toProcess.slice(i, i + CHUNK);
    const chunkText = chunkIndices
      .map((idx) => `=== PAGE ${idx + 1} ===\n${pages[idx]}`)
      .join('\n\n');

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-04-17',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `You are an expert Australian bank statement parser.
Extract EVERY individual transaction from this bank statement text.
Be thorough — do not skip any rows.

RULES:
- "debit"  = money OUT (purchases, bills, withdrawals, fees, transfers out)
- "credit" = money IN  (salary, deposits, refunds, transfers in, interest earned)
- amount is always a positive number
- date format output: YYYY-MM-DD
- If you see a debit column AND credit column on the same line, use whichever has a value
- SKIP: page headers, column headings, account summaries, opening/closing balance rows, totals rows

Return ONLY a valid JSON array. No markdown. No explanation.
[{"date":"YYYY-MM-DD","description":"MERCHANT OR DESCRIPTION","amount":45.60,"type":"debit","balance":1234.56}]

BANK STATEMENT TEXT:
${chunkText.substring(0, 14000)}`,
              },
            ],
          },
        ],
        config: { temperature: 0 },
      });

      const raw = (response.text ?? '')
        .replace(/```json\n?/g, '')
        .replace(/```/g, '')
        .trim();
      const jsonStr = raw.startsWith('[')
        ? raw
        : (raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]');
      const parsed: any[] = JSON.parse(jsonStr);

      // Save to rawTransactions sub-collection
      const txBatch = writeBatch(db);
      let saved = 0;
      for (const tx of parsed) {
        if (!tx.date || tx.amount == null) continue;
        const amt = Math.abs(Number(tx.amount));
        if (!isFinite(amt) || amt < 0.01) continue;
        const type: 'debit' | 'credit' =
          tx.type === 'credit' ? 'credit' : 'debit';
        const desc = String(tx.description ?? '');
        const txRef = doc(
          collection(db, `${importPath}/rawTransactions`)
        );
        txBatch.set(txRef, {
          importId,
          date: parseDate(tx.date),
          description: desc,
          cleanDescription: cleanDesc(desc),
          amount: amt,
          type,
          category: type === 'credit' ? 'income' : 'other',
          subcategory: null,
          fromCache: false,
          needsClarification: false,
          pageSource: chunkIndices[0],
          status: 'pending_review',
          incomeType:
            type === 'credit' ? detectIncomeType(desc) : null,
          balance:
            tx.balance != null ? Math.abs(Number(tx.balance)) : null,
          createdAt: serverTimestamp(),
        });
        saved++;
      }
      if (saved > 0) await txBatch.commit();

      newProcessed.push(...chunkIndices);
      await updateDoc(doc(db, importPath), {
        processedPages: newProcessed,
        failedPages: newFailed,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn(`[bankImport] pages ${chunkIndices} failed:`, e);
      newFailed.push(...chunkIndices);
      // Save failed state but keep going with remaining chunks
      await updateDoc(doc(db, importPath), {
        failedPages: newFailed,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
  }

  // All chunks attempted — now categorise
  await categoriseImport(importId, householdId);
};

// ── 3. Categorisation ────────────────────────────────────────────────────────

export const categoriseImport = async (
  importId: string,
  householdId: string
): Promise<void> => {
  const importPath = `households/${householdId}/bankImports/${importId}`;

  await updateDoc(doc(db, importPath), {
    status: 'categorising' as ImportStatus,
    updatedAt: serverTimestamp(),
  });

  const txSnap = await getDocs(
    query(
      collection(db, `${importPath}/rawTransactions`),
      orderBy('date', 'desc')
    )
  );

  const txs = txSnap.docs.map((d) => ({
    id: d.id,
    description:
      (d.data().cleanDescription as string) ||
      (d.data().description as string) ||
      '',
    type: d.data().type as 'debit' | 'credit',
  }));

  if (txs.length > 0) {
    const cats = await batchCategorizeWithCache(
      txs.map((t) => ({ description: t.description, type: t.type })),
      householdId
    ).catch(() => txs.map(() => ({ category: 'other', subcategory: undefined as string | undefined, fromCache: false })));

    const catBatch = writeBatch(db);
    txs.forEach((tx, i) => {
      const cat = cats[i];
      if (!cat) return;
      catBatch.update(
        doc(db, `${importPath}/rawTransactions`, tx.id),
        {
          category: cat.category,
          subcategory: cat.subcategory ?? null,
          fromCache: cat.fromCache,
          // Flag income transactions that need a human label
          needsClarification:
            tx.type === 'credit' &&
            cat.category === 'income' &&
            !cats[i].subcategory,
        }
      );
    });
    await catBatch.commit();
  }

  const importSnap = await getDoc(doc(db, importPath));
  const hasFailed =
    (importSnap.data()?.failedPages?.length ?? 0) > 0;

  await updateDoc(doc(db, importPath), {
    status: (hasFailed
      ? 'partially_failed'
      : 'needs_review') as ImportStatus,
    transactionCount: txs.length,
    updatedAt: serverTimestamp(),
  });
};

// ── 4. Resume unfinished imports on app open ─────────────────────────────────

/**
 * Call this when FinancesTab mounts.
 * Finds any import stuck in 'ai_parsing' or 'extracting' and resumes it.
 */
export const resumeUnfinishedImports = async (
  householdId: string
): Promise<void> => {
  const snap = await getDocs(
    collection(db, `households/${householdId}/bankImports`)
  );
  for (const d of snap.docs) {
    const status = d.data().status as ImportStatus;
    if (status === 'ai_parsing' || status === 'extracting' || status === 'categorising') {
      processImportInBackground(d.id, householdId).catch(console.warn);
    }
  }
};

// ── 5. Retry failed pages ────────────────────────────────────────────────────

export const retryFailedPages = async (
  importId: string,
  householdId: string
): Promise<void> => {
  const importPath = `households/${householdId}/bankImports/${importId}`;
  const importSnap = await getDoc(doc(db, importPath));
  if (!importSnap.exists()) return;

  const { failedPages, processedPages, totalPages } = importSnap.data();
  if (!failedPages?.length) return;

  // Load page texts from Firestore (no re-upload!)
  const pageDocs = await getDocs(collection(db, `${importPath}/pages`));
  const pages: string[] = new Array(totalPages).fill('');
  pageDocs.forEach((d) => {
    const idx = d.data().pageIndex as number;
    pages[idx] = d.data().text ?? '';
  });

  // Remove failed pages from the failed list, keep them out of processed
  // so processImportInBackground will retry them
  const stillProcessed = (processedPages as number[]).filter(
    (p) => !(failedPages as number[]).includes(p)
  );
  await updateDoc(doc(db, importPath), {
    failedPages: [],
    processedPages: stillProcessed,
    status: 'ai_parsing' as ImportStatus,
    updatedAt: serverTimestamp(),
  });

  processImportInBackground(importId, householdId, pages).catch(
    console.warn
  );
};

// ── 6. Confirm (move to main expenses) ──────────────────────────────────────

export const confirmImportTransactions = async (
  importId: string,
  householdId: string,
  userId: string,
  selectedIds: string[]
): Promise<number> => {
  const importPath = `households/${householdId}/bankImports/${importId}`;
  const txSnap = await getDocs(
    collection(db, `${importPath}/rawTransactions`)
  );

  let confirmed = 0;
  const expBatch = writeBatch(db);
  const stateBatch = writeBatch(db);

  for (const d of txSnap.docs) {
    const tx = d.data();
    const isSelected = selectedIds.includes(d.id);

    if (isSelected && tx.status === 'pending_review') {
      const coll =
        tx.type === 'credit'
          ? `households/${householdId}/bankTransactions`
          : `households/${householdId}/expenses`;

      const dateObj: Date =
        tx.date instanceof Timestamp
          ? tx.date.toDate()
          : new Date(tx.date?.seconds ? tx.date.seconds * 1000 : tx.date);

      expBatch.set(doc(collection(db, coll)), {
        merchantName: tx.cleanDescription || tx.description,
        description: tx.description,
        amount: tx.amount,
        total: tx.amount,
        category: tx.category,
        subcategory: tx.subcategory ?? null,
        date: dateObj,
        type: tx.type,
        incomeType: tx.incomeType ?? null,
        bankSource: 'bank_import',
        importedAt: serverTimestamp(),
        importedBy: userId,
        importId,
        source: 'bank_import',
        budgetMonth: format(dateObj, 'yyyy-MM'),
        lineItems: [],
      });

      stateBatch.update(
        doc(db, `${importPath}/rawTransactions`, d.id),
        { status: 'confirmed' }
      );
      confirmed++;
    } else if (!isSelected && tx.status === 'pending_review') {
      stateBatch.update(
        doc(db, `${importPath}/rawTransactions`, d.id),
        { status: 'rejected' }
      );
    }
  }

  await expBatch.commit();
  await stateBatch.commit();
  await updateDoc(doc(db, importPath), {
    status: 'completed' as ImportStatus,
    updatedAt: serverTimestamp(),
  });

  return confirmed;
};
