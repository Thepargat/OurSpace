/**
 * OurSpace — Bank Import Flow
 * Beautiful bottom-sheet import with live per-batch progress.
 * PDF: pdfjs text extract → Gemini 2.5 Flash in 3-page chunks
 * CSV: instant parse, zero AI
 * Merchant cache: imported merchants never hit AI again
 */

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Upload, X, Check, AlertTriangle, Loader2,
  Zap, Database, TrendingDown, TrendingUp, ChevronDown,
} from 'lucide-react';
import {
  parseCSV,
  parsePDFSmart,
  batchCategorizeWithCache,
  checkDuplicate,
  BankTransaction,
} from '../../lib/bankParsers';
import { useAuth } from '../AuthWrapper';
import { db } from '../../firebase';
import {
  collection, addDoc, serverTimestamp,
  getDocs, query, orderBy, limit,
} from 'firebase/firestore';
import { getCategoryDef } from '../../design/tokens';
import { formatAUD } from '../../lib/cashflow';
import { SPRING_DEFAULT, SPRING_BOUNCY } from '../../lib/motion';
import { format } from 'date-fns';

interface Props { onClose: () => void; onImported: (count: number) => void; }
type Step = 'upload' | 'processing' | 'preview' | 'importing' | 'done';

interface PreviewTx extends BankTransaction {
  category: string;
  subcategory?: string;
  fromCache: boolean;
  selected: boolean;
  isDuplicate: boolean;
  matchedMerchant?: string;
}

// ── tiny progress step pill ─────────────────────────────────
function StepPill({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-outfit text-[11px] transition-all ${
      done ? 'bg-[#4CAF50]/15 text-[#4CAF50]' :
      active ? 'bg-[#B8955A]/15 text-[#B8955A]' :
      'bg-[#EDE8DF] text-[#A8A29E]'
    }`}>
      {done ? <Check size={10} strokeWidth={3} /> :
       active ? <Loader2 size={10} className="animate-spin" /> :
       <div className="w-2 h-2 rounded-full bg-current opacity-40" />}
      {label}
    </div>
  );
}

export default function BankImportFlow({ onClose, onImported }: Props) {
  const { householdId, user } = useAuth();
  const [step, setStep] = useState<Step>('upload');
  const [transactions, setTransactions] = useState<PreviewTx[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'expenses' | 'income' | 'duplicates'>('all');
  const [isDragging, setIsDragging] = useState(false);

  // Processing state
  const [pdfProgress, setPdfProgress] = useState(0);
  const [pdfStatus, setPdfStatus] = useState('');
  const [pdfFound, setPdfFound] = useState(0);
  const [catProgress, setCatProgress] = useState(0);
  const [cacheHits, setCacheHits] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [processingStage, setProcessingStage] = useState<'extract' | 'ai' | 'categorise' | 'done'>('extract');

  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!householdId) return;
    setError('');
    setStep('processing');
    setPdfProgress(0);
    setPdfFound(0);
    setCatProgress(0);
    setProcessingStage('extract');

    try {
      let raw: BankTransaction[] = [];

      if (file.name.toLowerCase().endsWith('.pdf')) {
        setProcessingStage('ai');
        raw = await parsePDFSmart(file, (pct, status, found) => {
          setPdfProgress(pct);
          setPdfStatus(status);
          if (found != null) setPdfFound(found);
          // Detect page count from status string
          const m = status.match(/(\d+) pages extracted/);
          if (m) setTotalPages(parseInt(m[1]));
        });
        setPdfProgress(100);
      } else {
        setProcessingStage('ai');
        setPdfStatus('Parsing CSV…');
        const text = await file.text();
        raw = parseCSV(text, file.name);
        setPdfProgress(100);
        setPdfStatus(`Parsed ${raw.length} transactions`);
        setPdfFound(raw.length);
      }

      // Fetch existing expenses for duplicate check
      setProcessingStage('categorise');
      setPdfStatus('Checking for duplicates…');
      const expSnap = await getDocs(
        query(collection(db, `households/${householdId}/expenses`), orderBy('date', 'desc'), limit(500))
      );
      const existing = expSnap.docs.map(d => ({
        id: d.id,
        merchantName: d.data().merchantName || '',
        total: d.data().total || 0,
        date: d.data().date?.toDate() || new Date(),
      }));

      // Categorise — cache-first, Gemini 2.5 for unknowns
      const toProcess = raw.slice(0, 1000);
      const cats = await batchCategorizeWithCache(
        toProcess.map(tx => ({ description: tx.cleanDescription || tx.description, type: tx.type })),
        householdId,
        (pct) => {
          setCatProgress(pct);
          if (pct < 35) setPdfStatus('Checking merchant cache…');
          else if (pct < 100) setPdfStatus('Categorising with Gemini 2.5…');
          else setPdfStatus('Done');
        }
      );

      const hits = cats.filter(c => c.fromCache).length;
      setCacheHits(hits);

      const previews: PreviewTx[] = toProcess.map((tx, i) => {
        const cat = cats[i] || { category: 'other', fromCache: false };
        const dup = tx.type === 'debit' ? checkDuplicate(tx, existing) : { isDuplicate: false };
        return {
          ...tx,
          category: cat.category,
          subcategory: cat.subcategory,
          fromCache: cat.fromCache,
          selected: !dup.isDuplicate,
          isDuplicate: dup.isDuplicate,
          matchedMerchant: (dup as any).matchedMerchant,
        };
      });

      setTransactions(previews);
      setProcessingStage('done');
      setStep('preview');
    } catch (e: any) {
      setError(e.message || 'Failed to process file');
      setStep('upload');
    }
  }, [householdId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleImport = async () => {
    if (!householdId || !user) return;
    setStep('importing');
    const toImport = transactions.filter(t => t.selected);
    let count = 0;
    for (const tx of toImport) {
      try {
        const coll = tx.type === 'credit'
          ? `households/${householdId}/bankTransactions`
          : `households/${householdId}/expenses`;
        await addDoc(collection(db, coll), {
          merchantName: tx.cleanDescription || tx.description,
          description: tx.description,
          amount: Math.abs(tx.amount),
          total: Math.abs(tx.amount),
          category: tx.category,
          subcategory: tx.subcategory || null,
          date: tx.date,
          type: tx.type,
          incomeType: tx.incomeType || null,
          bankSource: tx.bankSource,
          importedAt: serverTimestamp(),
          importedBy: user.uid,
          source: 'bank_import',
          budgetMonth: format(tx.date, 'yyyy-MM'),
          lineItems: [],
        });
        count++;
      } catch { /* skip single failure */ }
    }
    setImportedCount(count);
    setStep('done');
    onImported(count);
  };

  const filtered = transactions.filter(t => {
    if (activeFilter === 'expenses')   return t.type === 'debit' && !t.isDuplicate;
    if (activeFilter === 'income')     return t.type === 'credit';
    if (activeFilter === 'duplicates') return t.isDuplicate;
    return true;
  });

  const stats = {
    expenses:   transactions.filter(t => t.type === 'debit').length,
    income:     transactions.filter(t => t.type === 'credit').length,
    duplicates: transactions.filter(t => t.isDuplicate).length,
    selected:   transactions.filter(t => t.selected).length,
    totalSpent: transactions.filter(t => t.type === 'debit' && t.selected).reduce((s, t) => s + Math.abs(t.amount), 0),
    totalIncome: transactions.filter(t => t.type === 'credit' && t.selected).reduce((s, t) => s + Math.abs(t.amount), 0),
  };

  const aiCalls = transactions.length - cacheHits;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] bg-[#1A1A1A]/60 backdrop-blur-sm flex items-end"
      onClick={step === 'upload' ? onClose : undefined}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={SPRING_DEFAULT}
        className="bg-[#fcf9f4] rounded-t-[28px] w-full max-h-[93dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-[#D4CEC4] rounded-full mx-auto mt-3 flex-shrink-0" />

        {/* Header */}
        <div className="px-6 pt-4 pb-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-serif text-[22px] text-[#1A1A1A]">Import Bank Statement</h2>
            <p className="font-outfit text-[12px] text-[#6B6560] mt-0.5">
              CommBank · NAB · ANZ · Westpac · Macquarie · ING · any bank
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center"
          >
            <X size={18} className="text-[#1A1A1A]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">

            {/* ─── UPLOAD ─────────────────────────────────────── */}
            {step === 'upload' && (
              <motion.div
                key="upload"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                className="px-6 pb-10"
              >
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".csv,.pdf"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />

                {/* Drop zone */}
                <motion.div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                  animate={{ scale: isDragging ? 1.02 : 1 }}
                  whileTap={{ scale: 0.98 }}
                  className={`mt-2 rounded-3xl border-2 border-dashed p-10 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-[#B8955A] bg-[#B8955A]/8'
                      : 'border-[#D4CEC4] hover:border-[#B8955A] hover:bg-[#B8955A]/4'
                  }`}
                >
                  <motion.div
                    animate={{ y: isDragging ? -4 : 0 }}
                    transition={{ type: 'spring', stiffness: 400 }}
                    className="w-16 h-16 rounded-2xl bg-[#EDE8DF] flex items-center justify-center mb-4"
                  >
                    <Upload size={28} className="text-[#B8955A]" />
                  </motion.div>
                  <h3 className="font-serif text-[19px] text-[#1A1A1A] mb-1">
                    {isDragging ? 'Drop it here' : 'Choose or drop a file'}
                  </h3>
                  <p className="font-outfit text-[13px] text-[#6B6560] text-center leading-relaxed">
                    PDF bank statement or CSV export<br />Up to 3 months — any page count
                  </p>
                </motion.div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 p-4 bg-[#FDF0EE] border border-[#E8A090] rounded-2xl flex items-start gap-3"
                  >
                    <AlertTriangle size={16} className="text-[#C47B6A] flex-shrink-0 mt-0.5" />
                    <p className="font-outfit text-[13px] text-[#C47B6A]">{error}</p>
                  </motion.div>
                )}

                {/* Smart-import info cards */}
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {[
                    { icon: <Zap size={14} />, title: 'Gemini 2.5 Flash', body: '3 pages at a time — never sends full PDF' },
                    { icon: <Database size={14} />, title: 'Merchant cache', body: 'Repeat merchants = instant, zero AI cost' },
                    { icon: <Check size={14} />, title: 'Duplicate guard', body: 'Already-scanned receipts flagged automatically' },
                    { icon: <TrendingUp size={14} />, title: 'Income detected', body: 'Salary, refunds, transfers split out' },
                  ].map(c => (
                    <div key={c.title} className="bg-[#EDE8DF] rounded-2xl p-3.5">
                      <div className="flex items-center gap-1.5 text-[#B8955A] mb-1">{c.icon}<span className="font-outfit text-[11px] font-semibold">{c.title}</span></div>
                      <p className="font-outfit text-[11px] text-[#6B6560] leading-snug">{c.body}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ─── PROCESSING ─────────────────────────────────── */}
            {step === 'processing' && (
              <motion.div
                key="processing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="px-6 pb-10 flex flex-col items-center pt-6"
              >
                {/* Step pills */}
                <div className="flex gap-2 mb-8 flex-wrap justify-center">
                  <StepPill label="Extract text" done={processingStage !== 'extract'} active={processingStage === 'extract'} />
                  <StepPill label="Gemini 2.5 AI" done={processingStage === 'categorise' || processingStage === 'done'} active={processingStage === 'ai'} />
                  <StepPill label="Categorise" done={processingStage === 'done'} active={processingStage === 'categorise'} />
                </div>

                {/* Live counter */}
                <motion.div
                  key={pdfFound}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="mb-2"
                >
                  <p className="font-serif text-[64px] text-[#1A1A1A] leading-none text-center">{pdfFound}</p>
                </motion.div>
                <p className="font-outfit text-[14px] text-[#6B6560] mb-6">transactions found so far</p>

                {/* PDF progress bar */}
                <div className="w-full mb-2">
                  <div className="flex justify-between mb-1.5">
                    <span className="font-outfit text-[11px] text-[#6B6560]">{pdfStatus}</span>
                    <span className="font-outfit text-[11px] text-[#B8955A]">{Math.round(pdfProgress)}%</span>
                  </div>
                  <div className="w-full h-2 bg-[#EDE8DF] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-[#B8955A] rounded-full"
                      animate={{ width: `${pdfProgress}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                </div>

                {/* Categorise progress bar (only visible once categorising) */}
                {(processingStage === 'categorise' || processingStage === 'done') && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full mt-3">
                    <div className="flex justify-between mb-1.5">
                      <span className="font-outfit text-[11px] text-[#6B6560]">Categorising merchants</span>
                      <span className="font-outfit text-[11px] text-[#B8955A]">{Math.round(catProgress)}%</span>
                    </div>
                    <div className="w-full h-2 bg-[#EDE8DF] rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-[#4CAF50] rounded-full"
                        animate={{ width: `${catProgress}%` }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                      />
                    </div>
                  </motion.div>
                )}

                {totalPages > 0 && (
                  <p className="font-outfit text-[11px] text-[#A8A29E] mt-4">
                    {totalPages}-page statement · processing 3 pages at a time
                  </p>
                )}
              </motion.div>
            )}

            {/* ─── PREVIEW ────────────────────────────────────── */}
            {step === 'preview' && (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="px-6 pb-32"
              >
                {/* Hero summary */}
                <div className="bg-[#1A1A1A] rounded-[24px] p-5 mb-4 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-40 h-40 rounded-full bg-[#B8955A] opacity-10 blur-3xl pointer-events-none" />
                  <div className="relative z-10">
                    <p className="font-outfit text-[11px] uppercase tracking-[2px] text-[#B8955A] mb-1">
                      {transactions.length} transactions found
                    </p>
                    <div className="flex gap-6 mb-3">
                      <div>
                        <p className="font-outfit text-[10px] text-white/40 uppercase tracking-wider">Expenses</p>
                        <p className="font-serif text-[20px] text-white">{formatAUD(stats.totalSpent)}</p>
                      </div>
                      <div>
                        <p className="font-outfit text-[10px] text-white/40 uppercase tracking-wider">Income</p>
                        <p className="font-serif text-[20px] text-[#7FAF7B]">{formatAUD(stats.totalIncome)}</p>
                      </div>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                      <span className="font-outfit text-[11px] text-white/60">{stats.expenses} expenses</span>
                      <span className="font-outfit text-[11px] text-[#7FAF7B]">{stats.income} income</span>
                      {stats.duplicates > 0 && (
                        <span className="font-outfit text-[11px] text-[#FF9800]">{stats.duplicates} possible duplicates</span>
                      )}
                    </div>
                    {transactions.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-white/10">
                        <Database size={10} className="text-[#B8955A]" />
                        <span className="font-outfit text-[10px] text-white/50">
                          {cacheHits} from cache · {aiCalls} via Gemini 2.5
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Filter pills */}
                <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar pb-1">
                  {([
                    { key: 'all',        label: `All (${transactions.length})` },
                    { key: 'expenses',   label: `Expenses (${stats.expenses})` },
                    { key: 'income',     label: `Income (${stats.income})` },
                    ...(stats.duplicates > 0 ? [{ key: 'duplicates', label: `Dupes (${stats.duplicates})` }] : []),
                  ] as const).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveFilter(tab.key as typeof activeFilter)}
                      className={`px-4 py-2 rounded-full font-outfit text-[12px] whitespace-nowrap transition-all ${
                        activeFilter === tab.key
                          ? 'bg-[#1A1A1A] text-white'
                          : 'bg-[#EDE8DF] text-[#6B6560]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Select / deselect row */}
                <div className="flex justify-between items-center mb-3">
                  <p className="font-outfit text-[12px] text-[#6B6560]">
                    {stats.selected} selected
                  </p>
                  <div className="flex gap-3">
                    <button
                      className="font-outfit text-[12px] text-[#B8955A]"
                      onClick={() => setTransactions(p => p.map(t => ({ ...t, selected: true })))}
                    >Select all</button>
                    <button
                      className="font-outfit text-[12px] text-[#6B6560]"
                      onClick={() => setTransactions(p => p.map(t => ({ ...t, selected: false })))}
                    >Deselect all</button>
                  </div>
                </div>

                {/* Transaction list */}
                <div className="space-y-2 mb-4">
                  <AnimatePresence>
                    {filtered.map((tx, idx) => {
                      const catDef = getCategoryDef(tx.category);
                      return (
                        <motion.div
                          key={tx.id}
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(idx * 0.015, 0.3) }}
                          onClick={() => setTransactions(p =>
                            p.map(t => t.id === tx.id ? { ...t, selected: !t.selected } : t)
                          )}
                          className={`flex items-center gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${
                            tx.selected
                              ? 'bg-[#EDE8DF] border-[#D4CEC4]'
                              : 'bg-white border-[#E8E3DA] opacity-50'
                          } ${tx.isDuplicate ? 'border-[#FF9800]/40' : ''}`}
                        >
                          {/* Icon */}
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center text-[16px] flex-shrink-0"
                            style={{ background: tx.type === 'credit' ? '#E8F5E9' : catDef.light }}
                          >
                            {tx.type === 'credit' ? '💰' : catDef.emoji}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="font-outfit text-[13px] text-[#1A1A1A] truncate font-medium">
                              {tx.cleanDescription || tx.description}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="font-outfit text-[11px] text-[#6B6560]">
                                {tx.date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                              </span>
                              {tx.fromCache && (
                                <span className="font-outfit text-[10px] text-[#B8955A] bg-[#B8955A]/10 px-1.5 py-0.5 rounded-full">cached</span>
                              )}
                              {tx.isDuplicate && (
                                <span className="font-outfit text-[10px] text-[#FF9800]">already scanned</span>
                              )}
                            </div>
                          </div>

                          {/* Amount */}
                          <div className="text-right flex-shrink-0">
                            <p className={`font-serif text-[15px] ${tx.type === 'credit' ? 'text-[#4CAF50]' : 'text-[#1A1A1A]'}`}>
                              {tx.type === 'credit' ? '+' : ''}{formatAUD(Math.abs(tx.amount))}
                            </p>
                            <p className="font-outfit text-[10px] text-[#A8A29E]">{catDef.label}</p>
                          </div>

                          {/* Checkbox */}
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                            tx.selected ? 'bg-[#B8955A] border-[#B8955A]' : 'border-[#D4CEC4]'
                          }`}>
                            {tx.selected && <Check size={10} className="text-white" strokeWidth={3} />}
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}

            {/* ─── IMPORTING ──────────────────────────────────── */}
            {step === 'importing' && (
              <motion.div
                key="importing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-16 px-6"
              >
                <div className="w-20 h-20 rounded-full bg-[#EDE8DF] flex items-center justify-center mb-6">
                  <Loader2 size={36} className="text-[#B8955A] animate-spin" />
                </div>
                <h3 className="font-serif text-[22px] text-[#1A1A1A] mb-2">Saving…</h3>
                <p className="font-outfit text-[13px] text-[#6B6560]">{stats.selected} transactions</p>
              </motion.div>
            )}

            {/* ─── DONE ───────────────────────────────────────── */}
            {step === 'done' && (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={SPRING_BOUNCY}
                className="flex flex-col items-center justify-center py-12 px-6 text-center"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ ...SPRING_BOUNCY, delay: 0.1 }}
                  className="w-24 h-24 rounded-full bg-[#E8F5E9] flex items-center justify-center mb-6"
                >
                  <Check size={40} className="text-[#4CAF50]" strokeWidth={2.5} />
                </motion.div>
                <h3 className="font-serif text-[28px] text-[#1A1A1A] mb-2">Imported!</h3>
                <p className="font-outfit text-[15px] text-[#6B6560] mb-1">
                  {importedCount} transactions added
                </p>
                {cacheHits > 0 && (
                  <p className="font-outfit text-[12px] text-[#B8955A] mb-8">
                    {cacheHits} merchants cached — free next time
                  </p>
                )}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={onClose}
                  className="w-full h-14 rounded-full bg-[#1A1A1A] text-white font-outfit font-semibold text-[15px]"
                >
                  Done
                </motion.button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* ─── Sticky import button (only in preview) ─────────── */}
        <AnimatePresence>
          {step === 'preview' && (
            <motion.div
              initial={{ y: 80 }}
              animate={{ y: 0 }}
              exit={{ y: 80 }}
              transition={SPRING_DEFAULT}
              className="flex-shrink-0 px-6 pb-8 pt-4 bg-[#fcf9f4] border-t border-[#EDE8DF]"
            >
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleImport}
                disabled={stats.selected === 0}
                className={`w-full h-14 rounded-full font-outfit font-semibold text-[15px] flex items-center justify-center gap-2 transition-all ${
                  stats.selected > 0
                    ? 'bg-[#1A1A1A] text-white shadow-xl shadow-black/20'
                    : 'bg-[#D4CEC4] text-white/60 cursor-not-allowed'
                }`}
              >
                {stats.selected > 0 ? (
                  <>
                    <Check size={18} />
                    Import {stats.selected} transaction{stats.selected !== 1 ? 's' : ''}
                    <span className="text-white/60 text-[13px] font-normal ml-1">
                      ({formatAUD(stats.totalSpent + stats.totalIncome)})
                    </span>
                  </>
                ) : (
                  <>
                    <ChevronDown size={16} />
                    Select transactions to import
                  </>
                )}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
