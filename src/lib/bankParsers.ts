/**
 * OurSpace — Bank Statement Parsers
 * CSV: pure TS per-bank parsers (CommBank, NAB, ANZ, Westpac, Macquarie, ING, Bendigo, generic)
 * PDF: pdfjs-dist (free text extraction, Y/X sorted) → Gemini 2.5 Flash in 3-page chunks
 * Merchant cache: once categorised, never calls AI again for same merchant
 */

import { detectIncomeType } from './cashflow';

// ============================================================
// TYPES
// ============================================================
export interface BankTransaction {
  id: string;
  date: Date;
  description: string;
  cleanDescription: string;
  amount: number;         // negative = expense, positive = income
  balance?: number;
  type: 'debit' | 'credit';
  incomeType?: 'salary' | 'refund' | 'transfer' | 'interest' | 'other_income';
  bankSource: string;
  rawRow: string;
}

export type BankFormat = 'commbank' | 'nab' | 'anz' | 'westpac' | 'macquarie' | 'ing' | 'bendigo' | 'stgeorge' | 'generic';

// ============================================================
// BANK AUTO-DETECTION
// ============================================================
export const detectBank = (filename: string, firstLines: string): BankFormat => {
  const fn = filename.toLowerCase();
  const fl = firstLines.toLowerCase();

  if (fn.includes('commbank') || fl.includes('commonwealth bank') || fl.includes('netbank')) return 'commbank';
  if (fn.includes('nab') || fl.includes('national australia bank') || fl.includes('nab bank')) return 'nab';
  if (fn.includes('anz') || fl.includes('anz bank') || fl.includes('anz account')) return 'anz';
  if (fn.includes('westpac') || fl.includes('westpac')) return 'westpac';
  if (fn.includes('macquarie') || fl.includes('macquarie bank')) return 'macquarie';
  if (fn.includes('ing') || fl.includes('ing bank') || fl.includes('ing direct')) return 'ing';
  if (fn.includes('bendigo') || fl.includes('bendigo bank')) return 'bendigo';
  if (fn.includes('stgeorge') || fn.includes('st george') || fl.includes('st.george')) return 'stgeorge';
  return 'generic';
};

// ============================================================
// DESCRIPTION CLEANER
// ============================================================
const cleanDesc = (raw: string): string => {
  return raw
    .replace(/eftpos|pos purchase|pos debit|visa purchase|visa debit|eftpos purchase/gi, '')
    .replace(/card \d{4,}/gi, '')       // remove card numbers
    .replace(/\d{6,}/g, '')             // remove long reference numbers
    .replace(/value date:?\s*\d{2}\/\d{2}\/\d{4}/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^a-zA-Z]+/, '');        // remove leading non-alpha
};

// ============================================================
// PARSE DATE — handles DD/MM/YYYY, YYYY-MM-DD, "01 Apr 2026", etc.
// ============================================================
const parseDate = (str: string): Date => {
  if (!str) return new Date();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return new Date(str);

  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}/.test(str)) {
    const [d, m, y] = str.split('/').map(Number);
    return new Date(y, m - 1, d);
  }

  // "01 Apr 2026"
  const match = str.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (match) {
    return new Date(`${match[2]} ${match[1]}, ${match[3]}`);
  }

  return new Date(str);
};

// ============================================================
// PARSE AMOUNT — handles negative, parentheses, commas
// ============================================================
const parseAmount = (str: string, isDebit?: boolean): number => {
  if (!str) return 0;
  const negative = str.includes('−') || str.includes('-') || str.startsWith('(');
  const cleaned  = str.replace(/[^0-9.]/g, '');
  const value    = parseFloat(cleaned) || 0;
  if (isDebit) return -value;
  return negative ? -value : value;
};

// ============================================================
// COMMBANK CSV
// Format: Date,Amount,Description,Balance
// ============================================================
const parseCommBank = (csv: string): BankTransaction[] => {
  const lines = csv.split('\n').filter(l => l.trim() && !l.startsWith('"Date"'));
  return lines.map((line, i) => {
    const cols = parseCSVLine(line);
    const amount     = parseAmount(cols[1] || '0');
    const type: 'debit' | 'credit' = amount < 0 ? 'debit' : 'credit';
    const desc       = cols[2] || '';
    const clean      = cleanDesc(desc);
    const tx: BankTransaction = {
      id: `cb-${i}`,
      date: parseDate(cols[0] || ''),
      description: desc,
      cleanDescription: clean,
      amount,
      balance: parseAmount(cols[3] || '0'),
      type,
      bankSource: 'commbank',
      rawRow: line,
    };
    if (type === 'credit') tx.incomeType = detectIncomeType(desc);
    return tx;
  }).filter(t => !isNaN(t.amount));
};

// ============================================================
// NAB CSV
// Format: Date,Amount,Description,Merchant Name,Category
// ============================================================
const parseNAB = (csv: string): BankTransaction[] => {
  const lines = csv.split('\n').filter(l => l.trim() && !l.toLowerCase().startsWith('date'));
  return lines.map((line, i) => {
    const cols    = parseCSVLine(line);
    const amount  = parseAmount(cols[1] || '0');
    const type: 'debit' | 'credit' = amount < 0 ? 'debit' : 'credit';
    const desc    = cols[2] || '';
    const tx: BankTransaction = {
      id: `nab-${i}`,
      date: parseDate(cols[0] || ''),
      description: desc,
      cleanDescription: cleanDesc(desc),
      amount,
      type,
      bankSource: 'nab',
      rawRow: line,
    };
    if (type === 'credit') tx.incomeType = detectIncomeType(desc);
    return tx;
  }).filter(t => !isNaN(t.amount));
};

// ============================================================
// ANZ CSV
// Format: Details,Particulars,Code,Reference,Amount,Date,...
// ============================================================
const parseANZ = (csv: string): BankTransaction[] => {
  const lines = csv.split('\n').filter(l => l.trim() && !l.toLowerCase().startsWith('details'));
  return lines.map((line, i) => {
    const cols   = parseCSVLine(line);
    const amount = parseAmount(cols[4] || '0');
    const type: 'debit' | 'credit' = amount < 0 ? 'debit' : 'credit';
    const desc   = [cols[0], cols[1]].filter(Boolean).join(' ').trim();
    const tx: BankTransaction = {
      id: `anz-${i}`,
      date: parseDate(cols[5] || ''),
      description: desc,
      cleanDescription: cleanDesc(desc),
      amount,
      type,
      bankSource: 'anz',
      rawRow: line,
    };
    if (type === 'credit') tx.incomeType = detectIncomeType(desc);
    return tx;
  }).filter(t => !isNaN(t.amount));
};

// ============================================================
// WESTPAC CSV
// Format: "BSB","Account Number","Transaction Date","Narration","Cheque","Debit","Credit","Balance"
// ============================================================
const parseWestpac = (csv: string): BankTransaction[] => {
  const lines = csv.split('\n').filter(l => l.trim() && !l.toLowerCase().startsWith('"bsb"'));
  return lines.map((line, i) => {
    const cols = parseCSVLine(line);
    const debit  = parseAmount(cols[5] || '0');
    const credit = parseAmount(cols[6] || '0');
    const amount = credit > 0 ? credit : -debit;
    const type: 'debit' | 'credit' = amount < 0 ? 'debit' : 'credit';
    const desc = cols[3] || '';
    const tx: BankTransaction = {
      id: `wp-${i}`,
      date: parseDate(cols[2] || ''),
      description: desc,
      cleanDescription: cleanDesc(desc),
      amount,
      balance: parseAmount(cols[7] || '0'),
      type,
      bankSource: 'westpac',
      rawRow: line,
    };
    if (type === 'credit') tx.incomeType = detectIncomeType(desc);
    return tx;
  }).filter(t => !isNaN(t.amount));
};

// ============================================================
// GENERIC CSV PARSER — column detection fallback
// ============================================================
const parseGenericCSV = (csv: string): BankTransaction[] => {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase();
  const isDateFirst   = /^"?date/i.test(header);
  const hasDebitCredit = /debit.+credit|credit.+debit/i.test(header);

  return lines.slice(1).map((line, i) => {
    const cols = parseCSVLine(line);
    let date: Date = new Date(), amount = 0, desc = '';

    if (hasDebitCredit) {
      date   = parseDate(cols[0] || '');
      desc   = cols[1] || cols[2] || '';
      const debit  = parseAmount(cols[3] || '0');
      const credit = parseAmount(cols[4] || '0');
      amount = credit > 0 ? credit : -debit;
    } else if (isDateFirst) {
      date   = parseDate(cols[0] || '');
      amount = parseAmount(cols[1] || '0');
      desc   = cols[2] || '';
    } else {
      // last resort: find columns by pattern
      for (const col of cols) {
        if (/\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/.test(col)) { date = parseDate(col); continue; }
        if (/^-?\d+\.\d+$/.test(col.replace(/[$,]/g, '')))           { amount = parseAmount(col); continue; }
        if (col.length > 3 && !/^\d/.test(col))                      { desc = col; }
      }
    }

    const type: 'debit' | 'credit' = amount < 0 ? 'debit' : 'credit';
    const tx: BankTransaction = {
      id: `generic-${i}`,
      date,
      description: desc,
      cleanDescription: cleanDesc(desc),
      amount,
      type,
      bankSource: 'generic',
      rawRow: line,
    };
    if (type === 'credit') tx.incomeType = detectIncomeType(desc);
    return tx;
  }).filter(t => !isNaN(t.amount) && t.amount !== 0);
};

// ============================================================
// CSV LINE PARSER (handles quoted fields)
// ============================================================
const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ''));
  return result;
};

// ============================================================
// MAIN CSV PARSER — dispatches to bank-specific parser
// ============================================================
export const parseCSV = (csv: string, filename: string): BankTransaction[] => {
  const firstLines = csv.split('\n').slice(0, 3).join('\n');
  const bank = detectBank(filename, firstLines);

  try {
    switch (bank) {
      case 'commbank': return parseCommBank(csv);
      case 'nab':      return parseNAB(csv);
      case 'anz':      return parseANZ(csv);
      case 'westpac':  return parseWestpac(csv);
      default:         return parseGenericCSV(csv);
    }
  } catch (e) {
    console.warn(`${bank} parser failed, trying generic:`, e);
    return parseGenericCSV(csv);
  }
};

// ============================================================
// PDF TEXT EXTRACTION (pdfjs-dist — free, client-side)
// Sorts text items by Y then X so columns/rows are in reading order.
// Without this, pdfjs returns items in PDF-stream order which garbles columns.
// ============================================================
export const extractPDFText = async (file: File): Promise<{ pages: string[]; fullText: string }> => {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Sort by Y descending (top → bottom) then X ascending (left → right)
    // PDF Y=0 is bottom of page, so higher Y = higher on page.
    const items = [...content.items].sort((a: any, b: any) => {
      const yA = a.transform?.[5] ?? 0;
      const yB = b.transform?.[5] ?? 0;
      const yDiff = yB - yA;
      if (Math.abs(yDiff) > 4) return yDiff;               // different lines
      return (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0); // same line: left→right
    });

    // Group into lines by Y band, emit each line on its own row
    const lines: string[] = [];
    let lineY: number | null = null;
    let line = '';
    for (const item of items) {
      const str = (item as any).str ?? '';
      if (!str.trim()) continue;
      const y = Math.round(((item as any).transform?.[5] ?? 0) / 4) * 4;
      if (lineY === null) lineY = y;
      if (Math.abs(y - lineY) > 4) {
        if (line.trim()) lines.push(line.trim());
        line = '';
        lineY = y;
      }
      line += (line ? '  ' : '') + str;
    }
    if (line.trim()) lines.push(line.trim());

    pages.push(lines.join('\n'));
  }

  return { pages, fullText: pages.join('\n--- PAGE BREAK ---\n') };
};

// ============================================================
// KEYWORD FALLBACK CATEGORISER (no AI, no API key needed)
// ============================================================
export const guessCategory = (desc: string): string => {
  const d = desc.toLowerCase();
  if (/woolworths|coles|aldi|iga|costco|harris farm|foodworks/.test(d)) return 'groceries';
  if (/mcdonald|kfc|hungry jack|domino|pizza|cafe|restaurant|uber eat|doordash|menulog/.test(d)) return 'dining';
  if (/uber|ola|taxi|train|bus|transport|toll|opal|parking|petrol|bp |shell|caltex|ampol/.test(d)) return 'transport';
  if (/netflix|spotify|amazon prime|disney|youtube premium|stan|foxtel|apple tv|binge/.test(d)) return 'subscription';
  if (/gym|fitness|sport|swim|tennis|medicare|medibank|bupa|ahm/.test(d)) return 'health';
  if (/chemist|pharmacy|doctor|dentist|hospital|medical|pathology/.test(d)) return 'health';
  if (/electricity|water|gas|internet|nbn|optus|telstra|vodafone|aussie bb/.test(d)) return 'utilities';
  if (/rent|lease|strata|landlord|real estate/.test(d)) return 'rent';
  if (/amazon|ebay|kmart|target|big w|myer|david jones|the iconic|asos/.test(d)) return 'shopping';
  if (/insurance|aami|nrma|gio|allianz|budget direct|suncorp/.test(d)) return 'insurance';
  if (/salary|payroll|wages|pay from|employer/.test(d)) return 'income';
  return 'other';
};

// ============================================================
// BATCH CATEGORISE — merchant cache first, Gemini 2.5 Flash for unknowns
// 30 merchants per AI call. Cache saves result forever.
// ============================================================
export const batchCategorizeWithCache = async (
  transactions: Array<{ description: string; type: 'debit' | 'credit' }>,
  householdId: string,
  onProgress?: (pct: number) => void
): Promise<Array<{ category: string; subcategory?: string; fromCache: boolean }>> => {
  const { getMerchantCache, saveMerchantCache, normalizeMerchant } = await import('./merchantCache');

  const merchants = transactions.map(t => t.description);
  const cache = await getMerchantCache(householdId, merchants);

  const results: Array<{ category: string; subcategory?: string; fromCache: boolean }> = new Array(transactions.length);
  const uncachedIndices: number[] = [];

  transactions.forEach((tx, i) => {
    if (tx.type === 'credit') {
      results[i] = { category: 'income', fromCache: true };
      return;
    }
    const key = normalizeMerchant(tx.description);
    const cached = cache[key];
    if (cached) {
      results[i] = { category: cached.category, subcategory: cached.subcategory, fromCache: true };
    } else {
      // Keyword fallback first — covers obvious ones without any AI
      const kwCat = guessCategory(tx.description);
      if (kwCat !== 'other') {
        results[i] = { category: kwCat, fromCache: false };
      } else {
        uncachedIndices.push(i);
      }
    }
  });

  onProgress?.(30);
  if (uncachedIndices.length === 0) { onProgress?.(100); return results; }

  const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  const BATCH = 30;

  for (let b = 0; b < uncachedIndices.length; b += BATCH) {
    const slice = uncachedIndices.slice(b, b + BATCH);
    const items = slice.map(i => transactions[i].description);
    let batchResults: Array<{ category: string; subcategory?: string }> = items.map(d => ({ category: guessCategory(d) }));

    if (apiKey) {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-preview-04-17',
          contents: [{
            role: 'user',
            parts: [{ text: `Categorise these Australian bank transaction descriptions.
Categories: groceries, dining, transport, entertainment, health, shopping, utilities, rent, subscription, insurance, education, travel, personal_care, home, income, other.
Return ONLY a JSON array, no markdown, one object per item:
[{"category":"groceries","subcategory":"supermarket","isSubscription":false}]
Descriptions:
${items.map((d, i) => `${i + 1}. ${d}`).join('\n')}` }]
          }],
          config: { temperature: 0.1 },
        });
        const raw = (response.text ?? '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) batchResults = parsed;
      } catch { /* keep keyword fallback */ }
    }

    const cacheEntries: Array<{ merchant: string; entry: Partial<import('./merchantCache').MerchantEntry> }> = [];
    slice.forEach((txIdx, i) => {
      const cat = batchResults[i]?.category || 'other';
      const sub = batchResults[i]?.subcategory;
      results[txIdx] = { category: cat, subcategory: sub, fromCache: false };
      cacheEntries.push({
        merchant: transactions[txIdx].description,
        entry: { category: cat, subcategory: sub, isSubscription: cat === 'subscription', isIncome: cat === 'income', confirmedByUser: false },
      });
    });

    if (householdId) await saveMerchantCache(householdId, cacheEntries).catch(() => {});
    onProgress?.(30 + ((b + BATCH) / uncachedIndices.length) * 65);
  }

  onProgress?.(100);
  return results;
};

// ============================================================
// SMART PDF PARSER  (Gemini 2.5 Flash, 3-page text chunks)
//
// Pipeline:
//  1. pdfjs-dist  → extract text per page, Y/X sorted (free, ~0.5s/page)
//  2. Gemini 2.5 Flash → parse 3 pages of TEXT at a time (not PDF binary)
//     • ~$0.001 for 20-page statement vs ~$0.05+ for PDF binary
//  3. Dedup cross-chunk boundary duplicates (same date+amount+merchant)
//  4. batchCategorizeWithCache for categories (cache-first)
// ============================================================
export const parsePDFSmart = async (
  file: File,
  onProgress?: (pct: number, status: string, found?: number) => void
): Promise<BankTransaction[]> => {
  onProgress?.(3, 'Extracting text from PDF…');

  let pages: string[] = [];
  try {
    const extracted = await extractPDFText(file);
    pages = extracted.pages;
    onProgress?.(20, `${pages.length} pages extracted — reading transactions…`, 0);
  } catch {
    throw new Error('Could not read PDF. Try a different file or check it is not password-protected.');
  }

  const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Add VITE_GEMINI_API_KEY in your .env to parse PDF statements.');

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const CHUNK = 3; // pages per AI call
  const allTxs: BankTransaction[] = [];
  const seen = new Set<string>(); // dedup key: date+amount+first20chars

  for (let i = 0; i < pages.length; i += CHUNK) {
    const chunk = pages.slice(i, i + CHUNK);
    const chunkText = chunk.join('\n\n--- PAGE BREAK ---\n\n');
    const pct = 20 + ((i / pages.length) * 70);
    onProgress?.(pct, `Analysing pages ${i + 1}–${Math.min(i + CHUNK, pages.length)} of ${pages.length}…`, allTxs.length);

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-04-17',
        contents: [{
          role: 'user',
          parts: [{ text: `You are an expert Australian bank statement parser.
Extract EVERY transaction from this bank statement text. Be thorough — do not skip any lines.

Rules:
- "debit" = money OUT (purchases, bills, withdrawals, fees)
- "credit" = money IN (salary, refunds, transfers received, interest)
- amount is always a positive number
- date format: YYYY-MM-DD
- If a line shows a debit column AND credit column, use whichever has the value
- Skip: page headers, account summaries, opening/closing balances, column headings

Return ONLY a valid JSON array, no markdown, no explanation:
[{"date":"YYYY-MM-DD","description":"MERCHANT NAME","amount":45.60,"type":"debit","balance":1234.56}]

STATEMENT TEXT:
${chunkText.substring(0, 15000)}` }]
        }],
        config: { temperature: 0 },
      });

      const raw = (response.text ?? '').replace(/```json\n?/g, '').replace(/```/g, '').trim();
      // Sometimes model wraps in an object — try to extract the array
      const jsonStr = raw.startsWith('[') ? raw : (raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]');
      const parsed: any[] = JSON.parse(jsonStr);

      for (let j = 0; j < parsed.length; j++) {
        const tx = parsed[j];
        if (!tx.date || tx.amount == null) continue;
        const amt = Math.abs(Number(tx.amount));
        if (!isFinite(amt) || amt < 0.01) continue;

        const type: 'debit' | 'credit' = (tx.type === 'credit') ? 'credit' : 'debit';
        const dupKey = `${tx.date}|${amt.toFixed(2)}|${String(tx.description).substring(0, 20).toLowerCase()}`;
        if (seen.has(dupKey)) continue;
        seen.add(dupKey);

        const t: BankTransaction = {
          id: `pdf-${i}-${j}`,
          date: parseDate(tx.date),
          description: tx.description ?? '',
          cleanDescription: cleanDesc(tx.description ?? ''),
          amount: type === 'credit' ? amt : -amt,
          balance: tx.balance != null ? Math.abs(Number(tx.balance)) : undefined,
          type,
          bankSource: 'pdf-ai',
          rawRow: JSON.stringify(tx),
        };
        if (type === 'credit') t.incomeType = detectIncomeType(tx.description ?? '');
        allTxs.push(t);
      }
    } catch (e) {
      console.warn(`Chunk pages ${i + 1}–${i + CHUNK} failed:`, e);
      // Continue with remaining chunks — partial import beats total failure
    }
  }

  onProgress?.(95, `Found ${allTxs.length} transactions — sorting…`, allTxs.length);
  allTxs.sort((a, b) => b.date.getTime() - a.date.getTime());
  return allTxs;
};

// Backward-compat alias
export const parsePDF = parsePDFSmart;

// ============================================================
// DUPLICATE DETECTION
// ============================================================
export interface DuplicateCheck {
  isDuplicate: boolean;
  matchedExpenseId?: string;
  matchedMerchant?: string;
}

const levenshtein = (a: string, b: string): number => {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[a.length][b.length];
};

export const checkDuplicate = (
  tx: BankTransaction,
  existingExpenses: Array<{ id: string; merchantName: string; total: number; date: Date }>
): DuplicateCheck => {
  const txAbs = Math.abs(tx.amount);
  const txDate = tx.date;

  for (const exp of existingExpenses) {
    // Amount within $0.10
    if (Math.abs(Math.abs(exp.total) - txAbs) > 0.10) continue;

    // Date within 2 days
    const daysDiff = Math.abs(txDate.getTime() - exp.date.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff > 2) continue;

    // Merchant name fuzzy match
    const dist = levenshtein(
      tx.cleanDescription.toLowerCase().substring(0, 20),
      exp.merchantName.toLowerCase().substring(0, 20)
    );
    if (dist <= 4) {
      return { isDuplicate: true, matchedExpenseId: exp.id, matchedMerchant: exp.merchantName };
    }
  }

  return { isDuplicate: false };
};

// ============================================================
// SUBSCRIPTION DETECTION from recurring transactions
// ============================================================
export interface DetectedSubscription {
  merchantName: string;
  amount: number;
  intervalDays: number;
  frequency: 'monthly' | 'yearly' | 'weekly' | 'unknown';
  nextEstimatedDate: Date;
  occurrences: number;
}

export const detectSubscriptions = (transactions: BankTransaction[]): DetectedSubscription[] => {
  // Group debits by clean merchant name
  const merchantGroups = new Map<string, BankTransaction[]>();

  for (const tx of transactions) {
    if (tx.type !== 'debit') continue;
    const key = tx.cleanDescription.toLowerCase().substring(0, 30);
    if (!merchantGroups.has(key)) merchantGroups.set(key, []);
    merchantGroups.get(key)!.push(tx);
  }

  const subscriptions: DetectedSubscription[] = [];

  for (const [name, txs] of merchantGroups) {
    if (txs.length < 2) continue;

    // Sort by date
    txs.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Calculate average interval
    const intervals: number[] = [];
    for (let i = 1; i < txs.length; i++) {
      const days = (txs[i].date.getTime() - txs[i-1].date.getTime()) / (1000 * 60 * 60 * 24);
      intervals.push(days);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // Check consistency (within 5 days variance)
    const isConsistent = intervals.every(d => Math.abs(d - avgInterval) < 5);
    if (!isConsistent && txs.length < 4) continue;

    // Determine frequency
    let frequency: DetectedSubscription['frequency'] = 'unknown';
    if (avgInterval >= 25 && avgInterval <= 35)    frequency = 'monthly';
    else if (avgInterval >= 350 && avgInterval <= 380) frequency = 'yearly';
    else if (avgInterval >= 5 && avgInterval <= 9) frequency = 'weekly';

    if (frequency === 'unknown' && txs.length < 3) continue;

    // Average amount
    const avgAmount = Math.abs(txs.reduce((a, tx) => a + tx.amount, 0) / txs.length);
    const amountsConsistent = txs.every(tx => Math.abs(Math.abs(tx.amount) - avgAmount) < 2);
    if (!amountsConsistent && txs.length < 4) continue;

    // Estimate next charge
    const lastDate = txs[txs.length - 1].date;
    const nextDate = new Date(lastDate.getTime() + avgInterval * 24 * 60 * 60 * 1000);

    subscriptions.push({
      merchantName: txs[0].cleanDescription || name,
      amount: avgAmount,
      intervalDays: Math.round(avgInterval),
      frequency,
      nextEstimatedDate: nextDate,
      occurrences: txs.length,
    });
  }

  return subscriptions.sort((a, b) => b.amount - a.amount);
};
