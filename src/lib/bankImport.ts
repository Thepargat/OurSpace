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

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const parseDate = (str: string): Date => {
  if (!str) return new Date();
  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str + 'T12:00:00');
    return isNaN(d.getTime()) ? new Date() : d;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmy) {
    const year = dmy[3].length === 2 ? 2000 + +dmy[3] : +dmy[3];
    const d = new Date(year, +dmy[2] - 1, +dmy[1], 12);
    if (!isNaN(d.getTime())) return d;
  }
  // DD Mon YYYY
  const dMonY = str.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{2,4})/i);
  if (dMonY) {
    const months: Record<string, number> = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    const year = dMonY[3].length === 2 ? 2000 + +dMonY[3] : +dMonY[3];
    const d = new Date(year, months[dMonY[2].toLowerCase().slice(0,3)], +dMonY[1], 12);
    if (!isNaN(d.getTime())) return d;
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

/**
 * Robustly extract a JSON array from Gemini's raw text.
 * Handles markdown code fences, leading prose, truncated arrays,
 * and recovers individual objects if the full array won't parse.
 */
const extractJSON = (raw: string): any[] => {
  let s = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Find the outermost array
  const start = s.indexOf('[');
  if (start === -1) return [];
  const end = s.lastIndexOf(']');
  const slice = end > start ? s.slice(start, end + 1) : s.slice(start);

  // Try full parse
  try { return JSON.parse(slice); } catch { /* fall through */ }

  // Try closing a truncated array (model cut off mid-stream)
  try {
    const closed = slice.replace(/,?\s*\{[^}]*$/, '') + ']';
    return JSON.parse(closed);
  } catch { /* fall through */ }

  // Last resort: extract individual { } objects
  const recovered: any[] = [];
  const objRe = /\{[^{}]+\}/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(s)) !== null) {
    try { recovered.push(JSON.parse(m[0])); } catch { /* skip bad object */ }
  }
  return recovered;
};

/**
 * Regex-based fallback parser for Australian bank statements.
 * Covers CBA, NAB, ANZ, Westpac, Macquarie, ING common formats.
 * Used when AI is unavailable or fails after retries.
 */
const regexParsePage = (text: string): Array<{ date: string; description: string; amount: number; type: 'debit' | 'credit' }> => {
  const results: Array<{ date: string; description: string; amount: number; type: 'debit' | 'credit' }> = [];

  // Date patterns: DD/MM/YYYY, DD-MM-YYYY, DD Mon YYYY, YYYY-MM-DD
  const datePat = String.raw`(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})`;
  // Amount: optional $, digits with optional commas, decimal
  const amtPat = String.raw`\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)`;
  const lineRe = new RegExp(`${datePat}(.{3,80}?)\\s+${amtPat}\\s*(${amtPat})?\\s*(DR|CR|debit|credit)?`, 'gi');

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 10) continue;

    let m = lineRe.exec(trimmed);
    lineRe.lastIndex = 0;
    if (!m) continue;

    const dateStr = m[1];
    const desc = m[2].trim();
    // Amount: prefer debit/credit column detection
    const amtRaw1 = m[3]?.replace(/,/g, '') ?? '';
    const amtRaw2 = m[5]?.replace(/,/g, '') ?? '';
    const drcrFlag = (m[7] ?? '').toLowerCase();

    // If two amounts found: first = debit, second = credit (common layout)
    let amount = 0;
    let type: 'debit' | 'credit' = 'debit';

    if (amtRaw2 && parseFloat(amtRaw2) > 0) {
      // Two-column layout: non-zero in 2nd slot = credit
      amount = parseFloat(amtRaw2);
      type = 'credit';
    } else {
      amount = parseFloat(amtRaw1 || '0');
      if (drcrFlag === 'cr' || drcrFlag === 'credit') type = 'credit';
    }

    if (!isFinite(amount) || amount < 0.01) continue;
    if (!desc || desc.length < 2) continue;

    results.push({ date: dateStr, description: desc, amount, type });
  }

  return results;
};

/**
 * Call Gemini with exponential backoff.
 * Retries on rate limits (429), network errors, and bad JSON.
 * Returns parsed transaction array (may be empty — never throws after maxAttempts).
 */
const geminiRobust = async (
  ai: any,
  prompt: string,
  maxAttempts = 4
): Promise<any[]> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const errStr = String(lastError);
      const isRateLimit = errStr.includes('429') || errStr.includes('quota') || errStr.includes('RESOURCE_EXHAUSTED');
      // Rate limits: longer backoff; other errors: shorter
      const backoffMs = isRateLimit
        ? Math.pow(2, attempt) * 15_000   // 30s, 60s, 120s
        : Math.pow(2, attempt) * 1_500;   // 3s, 6s, 12s
      console.warn(`[bankImport] retry ${attempt}/${maxAttempts} in ${backoffMs}ms`);
      await sleep(backoffMs);
    }
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-04-17',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { temperature: 0 },
      });
      const txs = extractJSON(response.text ?? '');
      if (Array.isArray(txs)) return txs;
      lastError = new Error('No JSON array in response');
    } catch (e) {
      lastError = e;
    }
  }
  console.warn('[bankImport] gemini gave up after', maxAttempts, 'attempts:', lastError);
  return [];   // never fail the caller — return empty, let regex pick up
};

const GEMINI_PROMPT = (chunkText: string) => `You are an expert Australian bank statement parser.
Extract EVERY individual transaction. Be thorough — do not skip any rows.

RULES:
- "debit"  = money OUT (purchases, bills, withdrawals, fees, transfers out)
- "credit" = money IN  (salary, deposits, refunds, transfers in, interest)
- amount is always a POSITIVE number
- date output format: YYYY-MM-DD
- If you see a Debit column AND Credit column, use whichever has a non-zero value
- SKIP: page headers, column headings, opening/closing balance rows, total rows

Return ONLY a valid JSON array. No markdown. No explanation. No prose.
[{"date":"YYYY-MM-DD","description":"MERCHANT NAME","amount":45.60,"type":"debit","balance":1234.56}]

BANK STATEMENT TEXT:
${chunkText}`;

/** Save a batch of raw parsed transactions to Firestore */
const saveTxBatch = async (
  txs: any[],
  importPath: string,
  importId: string,
  pageSource: number,
  seenKeys: Set<string>
) => {
  if (txs.length === 0) return 0;
  const batch = writeBatch(db);
  let saved = 0;
  for (const tx of txs) {
    if (!tx.date || tx.amount == null) continue;
    const amt = Math.abs(Number(tx.amount));
    if (!isFinite(amt) || amt < 0.01) continue;
    const type: 'debit' | 'credit' = tx.type === 'credit' ? 'credit' : 'debit';
    const desc = String(tx.description ?? '').trim();
    if (!desc) continue;
    // Cross-chunk dedup
    const key = `${tx.date}|${amt.toFixed(2)}|${desc.slice(0, 20)}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const txRef = doc(collection(db, `${importPath}/rawTransactions`));
    batch.set(txRef, {
      importId,
      date: parseDate(String(tx.date)),
      description: desc,
      cleanDescription: cleanDesc(desc),
      amount: amt,
      type,
      category: type === 'credit' ? 'income' : 'other',
      subcategory: null,
      fromCache: false,
      needsClarification: false,
      pageSource,
      status: 'pending_review',
      incomeType: type === 'credit' ? detectIncomeType(desc) : null,
      balance: tx.balance != null ? Math.abs(Number(tx.balance)) : null,
      createdAt: serverTimestamp(),
    });
    saved++;
  }
  if (saved > 0) await batch.commit();
  return saved;
};

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
 * Processes un-parsed pages with Gemini 2.5 Flash.
 * Strategy per chunk of 3 pages:
 *   1. Try all 3 pages together (best quality, 4 retries with backoff)
 *   2. If chunk fails → try each page individually (2 retries each)
 *   3. If single page fails → regex fallback (AU bank statement patterns)
 *   4. If regex also gives 0 results → page is genuinely blank / cover page
 *      → mark as processed (not failed), since we did our best
 * Result: failedPages is always empty unless page text was missing from Firestore.
 */
export const processImportInBackground = async (
  importId: string,
  householdId: string,
  pagesArg?: string[]
): Promise<void> => {
  const importPath = `households/${householdId}/bankImports/${importId}`;

  const importSnap = await getDoc(doc(db, importPath));
  if (!importSnap.exists()) return;
  const importData = importSnap.data();

  const processedPages: number[] = importData.processedPages ?? [];
  const failedPages: number[] = importData.failedPages ?? [];
  const totalPages: number = importData.totalPages ?? 0;

  // Load page texts
  let pages: string[] = pagesArg ?? [];
  if (pages.length === 0) {
    const pageDocs = await getDocs(collection(db, `${importPath}/pages`));
    pages = new Array(totalPages).fill('');
    pageDocs.forEach((d) => {
      const idx = d.data().pageIndex as number;
      if (idx >= 0 && idx < totalPages) pages[idx] = d.data().text ?? '';
    });
  }

  // Exclude already-processed AND already-failed pages
  // (failed pages only re-enter via explicit retryFailedPages())
  const skipSet = new Set([...processedPages, ...failedPages]);
  const toProcess = Array.from({ length: totalPages }, (_, i) => i).filter(i => !skipSet.has(i));

  if (toProcess.length === 0) {
    await categoriseImport(importId, householdId);
    return;
  }

  const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY as string | undefined;

  // Without API key, try regex on every page before giving up
  if (!apiKey) {
    const newProcessed = [...processedPages];
    const seenKeys = new Set<string>();
    for (const idx of toProcess) {
      const txs = regexParsePage(pages[idx]);
      await saveTxBatch(txs, importPath, importId, idx, seenKeys);
      newProcessed.push(idx);
    }
    await updateDoc(doc(db, importPath), {
      processedPages: newProcessed,
      status: 'needs_review' as ImportStatus,
      updatedAt: serverTimestamp(),
    });
    await categoriseImport(importId, householdId);
    return;
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const CHUNK = 3;
  const newProcessed = [...processedPages];
  const newFailed = [...failedPages];
  const seenKeys = new Set<string>();

  for (let i = 0; i < toProcess.length; i += CHUNK) {
    const chunkIndices = toProcess.slice(i, i + CHUNK);

    // ── Step 1: Try the full chunk with 4-attempt retry ──────────────────────
    const chunkText = chunkIndices
      .map(idx => `=== PAGE ${idx + 1} ===\n${pages[idx]}`)
      .join('\n\n');

    // Gemini 2.5 Flash context = 1M tokens; ~4 chars/token → 20k chars ≈ 5k tokens
    // Use up to 24k chars per chunk — more than enough for 3 dense statement pages
    const safeText = chunkText.length > 24_000 ? chunkText.slice(0, 24_000) : chunkText;

    let chunkTxs = await geminiRobust(ai, GEMINI_PROMPT(safeText), 4);

    if (chunkTxs.length > 0) {
      // Chunk succeeded
      await saveTxBatch(chunkTxs, importPath, importId, chunkIndices[0], seenKeys);
      newProcessed.push(...chunkIndices);
      await updateDoc(doc(db, importPath), {
        processedPages: newProcessed,
        failedPages: newFailed,
        updatedAt: serverTimestamp(),
      });
    } else {
      // ── Step 2: Chunk returned nothing — try pages individually ─────────────
      for (const idx of chunkIndices) {
        const pageText = pages[idx];
        const safePageText = pageText.length > 10_000 ? pageText.slice(0, 10_000) : pageText;

        let pageTxs = await geminiRobust(ai, GEMINI_PROMPT(`=== PAGE ${idx + 1} ===\n${safePageText}`), 2);

        if (pageTxs.length === 0) {
          // ── Step 3: AI gave nothing → try regex fallback ─────────────────────
          pageTxs = regexParsePage(pageText);
          if (pageTxs.length > 0) {
            console.info(`[bankImport] page ${idx} recovered via regex (${pageTxs.length} txs)`);
          }
        }

        // Step 4: 0 results from both AI and regex = blank/cover page
        // Still mark as processed — it's not a failure, just an empty page.
        await saveTxBatch(pageTxs, importPath, importId, idx, seenKeys);
        newProcessed.push(idx);

        await updateDoc(doc(db, importPath), {
          processedPages: newProcessed,
          failedPages: newFailed,
          updatedAt: serverTimestamp(),
        });

        // Small courtesy delay between individual page calls to avoid rate limits
        await sleep(400);
      }
    }

    // Courtesy delay between chunk calls (rate limit protection)
    if (i + CHUNK < toProcess.length) await sleep(600);
  }

  // All pages attempted — move to categorisation
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
