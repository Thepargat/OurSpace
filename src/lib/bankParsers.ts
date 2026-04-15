/**
 * OurSpace — Bank Statement Parsers
 * Supports CommBank, NAB, ANZ, Westpac, Macquarie, ING, Bendigo, generic
 * CSV parsing is pure TS. PDF uses Gemini Vision.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
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
// ============================================================
export const extractPDFText = async (file: File): Promise<{ pages: string[]; fullText: string }> => {
  // Dynamic import so pdfjs-dist is only loaded when needed
  const pdfjsLib = await import('pdfjs-dist');
  // Point worker at the installed package worker
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
    const pageText = content.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ');
    pages.push(pageText);
  }

  return { pages, fullText: pages.join('\n--- PAGE BREAK ---\n') };
};

// ============================================================
// REGEX TRANSACTION PARSER (zero AI cost)
// Works on Australian bank statement text extracted by pdfjs-dist
// ============================================================
export const parseTransactionsFromText = (text: string): BankTransaction[] => {
  const transactions: BankTransaction[] = [];
  const lines = text.split(/\n|--- PAGE BREAK ---/).map(l => l.trim()).filter(Boolean);

  // Australian date patterns: DD/MM/YYYY, DD MMM YYYY, DD MMM YY
  const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2,4})/i;
  // Amount pattern: $1,234.56 or 1234.56 or (1,234.56) for negative
  const amountPattern = /(?:\$?\s*)((?:\([\d,]+\.\d{2}\))|(?:[\d,]+\.\d{2}))/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(datePattern);
    if (!dateMatch) continue;

    // Find all amounts on this line
    const amounts: number[] = [];
    let m: RegExpExecArray | null;
    amountPattern.lastIndex = 0;
    while ((m = amountPattern.exec(line)) !== null) {
      const raw = m[1];
      const isNeg = raw.startsWith('(');
      const val = parseFloat(raw.replace(/[^0-9.]/g, '')) * (isNeg ? -1 : 1);
      if (!isNaN(val) && val !== 0) amounts.push(val);
    }
    if (amounts.length === 0) continue;

    // Description: everything between date and first amount
    const dateEnd = dateMatch.index! + dateMatch[0].length;
    let desc = line.substring(dateEnd).replace(amountPattern, '').trim();
    if (!desc || desc.length < 3) desc = lines[i + 1]?.substring(0, 60) || 'Unknown';
    desc = cleanDesc(desc);
    if (!desc || desc.length < 2) continue;

    // Debit/credit heuristic:
    // If line has 2+ amounts, last is usually balance → use second-to-last as transaction
    // If negative → credit (money in), positive → debit (money out) — Australian convention
    const txAmount = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
    // In most AU bank statements, debits are shown as positive and credits negative OR
    // there's a separate Dr/Cr indicator
    const hasDr = /\bdr\b/i.test(line);
    const hasCr = /\bcr\b/i.test(line);
    const type: 'debit' | 'credit' = hasCr
      ? 'credit'
      : hasDr
      ? 'debit'
      : txAmount < 0
      ? 'credit'   // negative in statement = money in (credit)
      : 'debit';   // positive = money out (debit)

    const absAmount = Math.abs(txAmount);
    if (absAmount < 0.01 || absAmount > 1000000) continue;

    const t: BankTransaction = {
      id: `regex-${transactions.length}`,
      date: parseDate(dateMatch[0]),
      description: desc,
      cleanDescription: desc,
      amount: type === 'credit' ? absAmount : -absAmount,
      balance: amounts.length >= 2 ? Math.abs(amounts[amounts.length - 1]) : undefined,
      type,
      bankSource: 'pdf-regex',
      rawRow: line,
    };
    if (type === 'credit') t.incomeType = detectIncomeType(desc);
    transactions.push(t);
  }

  return transactions;
};

// ============================================================
// BATCH CATEGORIZE with merchant cache (minimises AI calls)
// ============================================================
export const batchCategorizeWithCache = async (
  transactions: Array<{ description: string; type: 'debit' | 'credit' }>,
  householdId: string,
  onProgress?: (pct: number) => void
): Promise<Array<{ category: string; subcategory?: string; fromCache: boolean }>> => {
  const { getMerchantCache, saveMerchantCache, normalizeMerchant } = await import('./merchantCache');

  // Load cache for all merchants
  const merchants = transactions.map(t => t.description);
  const cache = await getMerchantCache(householdId, merchants);

  const results: Array<{ category: string; subcategory?: string; fromCache: boolean }> = new Array(transactions.length);
  const uncachedIndices: number[] = [];

  // Apply cache hits
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
      uncachedIndices.push(i);
    }
  });

  onProgress?.(30);

  if (uncachedIndices.length === 0) {
    onProgress?.(100);
    return results;
  }

  // Batch uncached merchants — 30 per AI call
  const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  const BATCH_SIZE = 30;
  const batches: number[][] = [];
  for (let i = 0; i < uncachedIndices.length; i += BATCH_SIZE) {
    batches.push(uncachedIndices.slice(i, i + BATCH_SIZE));
  }

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const items = batch.map(i => transactions[i].description);

    let batchResults: Array<{ category: string; subcategory?: string }> = [];

    if (apiKey) {
      try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' }); // cheapest model
        const prompt = `Categorize these bank transaction descriptions. Categories: groceries, dining, transport, entertainment, health, shopping, utilities, rent, subscription, insurance, education, travel, personal_care, home, other.
Return ONLY a JSON array (no markdown), one object per item:
[{"category":"groceries","subcategory":"supermarket"}]
Descriptions:
${items.map((d, i) => `${i + 1}. ${d}`).join('\n')}`;

        const res = await model.generateContent(prompt);
        const text = res.response.text().replace(/```json\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(text);
        batchResults = Array.isArray(parsed) ? parsed : items.map(() => ({ category: 'other' }));
      } catch {
        batchResults = items.map(() => ({ category: 'other' }));
      }
    } else {
      // No API key: use simple keyword matching
      batchResults = items.map(d => ({ category: guessCategory(d) }));
    }

    // Apply results and save to cache
    const cacheEntries: Array<{ merchant: string; entry: Partial<import('./merchantCache').MerchantEntry> }> = [];
    batch.forEach((txIdx, i) => {
      const cat = batchResults[i]?.category || 'other';
      const sub = batchResults[i]?.subcategory;
      results[txIdx] = { category: cat, subcategory: sub, fromCache: false };
      cacheEntries.push({
        merchant: transactions[txIdx].description,
        entry: { category: cat, subcategory: sub, isSubscription: cat === 'subscription', isIncome: false, confirmedByUser: false },
      });
    });

    if (householdId) await saveMerchantCache(householdId, cacheEntries);
    onProgress?.(30 + ((batchIdx + 1) / batches.length) * 65);
  }

  onProgress?.(100);
  return results;
};

// Simple keyword fallback (no AI needed for obvious ones)
const guessCategory = (desc: string): string => {
  const d = desc.toLowerCase();
  if (/woolworths|coles|aldi|iga|costco|harris farm/.test(d)) return 'groceries';
  if (/mcdonald|kfc|hungry|domino|pizza|cafe|restaurant|uber eat|doordash/.test(d)) return 'dining';
  if (/uber|lyft|taxi|train|bus|transport|toll|opal|parking|petrol|bp |shell|caltex/.test(d)) return 'transport';
  if (/netflix|spotify|amazon|prime|disney|youtube|hulu|stan|foxtel|apple tv/.test(d)) return 'subscription';
  if (/gym|fitness|sport|swim|tennis/.test(d)) return 'health';
  if (/chemist|pharmacy|doctor|dentist|hospital|medical/.test(d)) return 'health';
  if (/electricity|water|gas|internet|phone|nbn|optus|telstra|vodafone/.test(d)) return 'utilities';
  if (/rent|lease|strata|landlord/.test(d)) return 'rent';
  if (/amazon|ebay|kmart|target|big w|myer|david jones/.test(d)) return 'shopping';
  if (/insurance|aami|nrma|budget direct/.test(d)) return 'insurance';
  return 'other';
};

// ============================================================
// SMART PDF PARSER (replaces old parsePDF)
// 1. Extract text client-side with pdfjs-dist (free)
// 2. Parse transactions with regex (free)
// 3. Only if regex fails → send TEXT (not PDF binary) to Gemini (cheap)
// ============================================================
export const parsePDFSmart = async (
  file: File,
  onProgress?: (pct: number, status: string) => void
): Promise<BankTransaction[]> => {
  onProgress?.(5, 'Extracting text from PDF…');

  let pages: string[] = [];
  let fullText = '';

  try {
    const extracted = await extractPDFText(file);
    pages = extracted.pages;
    fullText = extracted.fullText;
    onProgress?.(30, `Extracted ${pages.length} pages`);
  } catch (e) {
    onProgress?.(30, 'Text extraction failed, trying AI…');
  }

  // Try regex parser first (free)
  if (fullText) {
    const regexTxs = parseTransactionsFromText(fullText);
    if (regexTxs.length >= 5) {
      onProgress?.(90, `Found ${regexTxs.length} transactions via text`);
      return regexTxs;
    }
  }

  // Fallback: send TEXT to Gemini (much cheaper than PDF binary)
  const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Could not parse PDF — add VITE_GEMINI_API_KEY for AI parsing');

  onProgress?.(40, 'Sending text to AI for parsing…');

  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' }); // cheapest text model

  // If text extraction failed, send PDF as last resort — but in 3-page chunks
  let allTransactions: BankTransaction[] = [];

  if (!fullText && pages.length === 0) {
    // True last resort: send the actual PDF
    onProgress?.(50, 'Parsing PDF with AI…');
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    bytes.forEach(b => (binary += String.fromCharCode(b)));
    const base64 = btoa(binary);

    const result = await model.generateContent([
      { inlineData: { mimeType: 'application/pdf', data: base64 } },
      `Extract ALL bank transactions as JSON array. No markdown. Format: [{"date":"YYYY-MM-DD","description":"string","amount":-45.50,"type":"debit"}]. Negative amounts = expenses.`,
    ]);
    const raw = result.response.text().replace(/```json\n?/g, '').replace(/```/g, '').trim();
    const parsed: any[] = JSON.parse(raw);
    allTransactions = parsed.map((tx: any, i: number) => {
      const type: 'debit' | 'credit' = tx.amount < 0 ? 'debit' : 'credit';
      const t: BankTransaction = {
        id: `pdf-${i}`, date: parseDate(tx.date), description: tx.description,
        cleanDescription: cleanDesc(tx.description), amount: tx.amount,
        balance: tx.balance, type, bankSource: 'pdf-ai', rawRow: JSON.stringify(tx),
      };
      if (type === 'credit') t.incomeType = detectIncomeType(tx.description);
      return t;
    });
  } else {
    // Send text in page-group chunks (3 pages at a time) to Gemini
    const CHUNK_SIZE = 3;
    for (let i = 0; i < pages.length; i += CHUNK_SIZE) {
      const chunk = pages.slice(i, i + CHUNK_SIZE).join('\n');
      onProgress?.(40 + (i / pages.length) * 50, `Processing pages ${i + 1}–${Math.min(i + CHUNK_SIZE, pages.length)}…`);
      try {
        const result = await model.generateContent(
          `Extract bank transactions from this bank statement text. Return ONLY a JSON array, no markdown:
[{"date":"YYYY-MM-DD","description":"string","amount":-45.50,"type":"debit"}]
Rules: negative amounts=expenses, positive=income. Skip totals/summaries/headers.
TEXT:
${chunk.substring(0, 8000)}`
        );
        const raw = result.response.text().replace(/```json\n?/g, '').replace(/```/g, '').trim();
        const parsed: any[] = JSON.parse(raw);
        const chunkTxs = parsed.map((tx: any, j: number) => {
          const type: 'debit' | 'credit' = tx.amount < 0 ? 'debit' : 'credit';
          const t: BankTransaction = {
            id: `pdf-chunk${i}-${j}`, date: parseDate(tx.date), description: tx.description,
            cleanDescription: cleanDesc(tx.description), amount: tx.amount,
            balance: tx.balance, type, bankSource: 'pdf-ai-text', rawRow: JSON.stringify(tx),
          };
          if (type === 'credit') t.incomeType = detectIncomeType(tx.description);
          return t;
        });
        allTransactions.push(...chunkTxs);
      } catch { /* skip failed chunk */ }
    }
  }

  onProgress?.(95, `Parsed ${allTransactions.length} transactions`);
  return allTransactions;
};

// Keep old parsePDF as alias for backward compat
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
