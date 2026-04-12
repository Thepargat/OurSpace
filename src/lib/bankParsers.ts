/**
 * OurSpace — Bank Statement Parsers
 * Supports CommBank, NAB, ANZ, Westpac, Macquarie, ING, Bendigo, generic
 * CSV parsing is pure TS. PDF uses Gemini Vision.
 */

import { callGeminiVision } from './gemini';
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
// PDF PARSER — Gemini Vision
// ============================================================
export const parsePDF = async (
  file: File
): Promise<BankTransaction[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  const base64 = btoa(binary);

  const prompt = `Extract ALL bank transactions from this statement. Return ONLY a JSON array, no markdown:
[{
  "date": "YYYY-MM-DD",
  "description": "string",
  "amount": -45.50,
  "balance": 1234.56,
  "type": "debit"
}]
Rules:
- amount MUST be negative for expenses/debits, positive for income/credits
- Include every transaction visible — no summary rows
- date must be ISO format YYYY-MM-DD
- If balance not visible use null`;

  const text = (await callGeminiVision(prompt, base64, 'application/pdf', 'gemini-2.0-flash')).trim();
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed: Array<{ date: string; description: string; amount: number; balance?: number; type: 'debit' | 'credit' }> = JSON.parse(cleaned);

  return parsed.map((tx, i) => {
    const type: 'debit' | 'credit' = tx.amount < 0 ? 'debit' : 'credit';
    const t: BankTransaction = {
      id: `pdf-${i}`,
      date: parseDate(tx.date),
      description: tx.description,
      cleanDescription: cleanDesc(tx.description),
      amount: tx.amount,
      balance: tx.balance,
      type,
      bankSource: `pdf-${file.name}`,
      rawRow: JSON.stringify(tx),
    };
    if (type === 'credit') t.incomeType = detectIncomeType(tx.description);
    return t;
  });
};

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
