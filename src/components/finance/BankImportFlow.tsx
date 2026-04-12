/**
 * OurSpace — Bank Import Flow
 * Supports CSV (CommBank, NAB, ANZ, Westpac, generic) and PDF (Gemini Vision)
 */

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, X, Check, AlertTriangle, ChevronRight, FileText, Loader2 } from 'lucide-react';
import { parseCSV, parsePDF, checkDuplicate, BankTransaction } from '../../lib/bankParsers';
import { useAuth } from '../AuthWrapper';
import { db } from '../../firebase';
import { collection, addDoc, serverTimestamp, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { BUILT_IN_CATEGORIES, getCategoryDef } from '../../design/tokens';
import { categorizeItem } from '../../lib/categorization';
import { formatAUD } from '../../lib/cashflow';
import { SPRING_DEFAULT, SPRING_BOUNCY, staggerContainer, staggerItem } from '../../lib/motion';

interface Props {
  onClose: () => void;
  onImported: (count: number) => void;
}

type Step = 'upload' | 'preview' | 'importing' | 'done';

interface PreviewTransaction extends BankTransaction {
  category: string;
  categoryConfidence: number;
  selected: boolean;
  isDuplicate: boolean;
  matchedMerchant?: string;
}

export default function BankImportFlow({ onClose, onImported }: Props) {
  const { householdId, user } = useAuth();
  const [step, setStep] = useState<Step>('upload');
  const [transactions, setTransactions] = useState<PreviewTransaction[]>([]);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [error, setError] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'expenses' | 'income' | 'duplicates'>('all');
  const [processingProgress, setProcessingProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!householdId) return;
    setError('');
    setStep('preview');
    setProcessingProgress(0);

    try {
      let raw: BankTransaction[] = [];

      if (file.name.toLowerCase().endsWith('.pdf')) {
        setProcessingProgress(10);
        raw = await parsePDF(file);
        setProcessingProgress(50);
      } else {
        const text = await file.text();
        raw = parseCSV(text, file.name);
        setProcessingProgress(30);
      }

      // Fetch existing expenses for duplicate check
      const expSnap = await getDocs(
        query(collection(db, `households/${householdId}/expenses`), orderBy('date', 'desc'), limit(200))
      );
      const existingExpenses = expSnap.docs.map(d => ({
        id: d.id,
        merchantName: d.data().merchantName || '',
        total: d.data().total || 0,
        date: d.data().date?.toDate() || new Date(),
      }));

      setProcessingProgress(60);

      // Categorize + duplicate check
      const previews: PreviewTransaction[] = await Promise.all(
        raw.slice(0, 500).map(async (tx, i) => {
          const catResult = tx.type === 'debit'
            ? await categorizeItem(tx.cleanDescription, tx.cleanDescription, householdId)
            : { cat: 'income', confidence: 1.0 };

          const dupCheck = tx.type === 'debit'
            ? checkDuplicate(tx, existingExpenses)
            : { isDuplicate: false };

          setProcessingProgress(60 + (i / raw.length) * 35);

          return {
            ...tx,
            category: catResult.cat,
            categoryConfidence: catResult.confidence,
            selected: !dupCheck.isDuplicate,
            isDuplicate: dupCheck.isDuplicate,
            matchedMerchant: dupCheck.matchedMerchant,
          };
        })
      );

      setProcessingProgress(100);
      setTransactions(previews);
    } catch (e: any) {
      setError(e.message || 'Failed to parse file');
      setStep('upload');
    }
  };

  const handleImport = async () => {
    if (!householdId || !user) return;
    setImporting(true);
    setStep('importing');

    const toImport = transactions.filter(t => t.selected);
    let count = 0;

    for (const tx of toImport) {
      try {
        const coll = tx.type === 'credit'
          ? `households/${householdId}/bankTransactions`
          : `households/${householdId}/expenses`;

        await addDoc(collection(db, coll), {
          merchantName: tx.cleanDescription,
          description: tx.description,
          amount: Math.abs(tx.amount),
          total: Math.abs(tx.amount),
          category: tx.category,
          date: tx.date,
          type: tx.type,
          incomeType: tx.incomeType || null,
          bankSource: tx.bankSource,
          importedAt: serverTimestamp(),
          importedBy: user.uid,
          source: 'bank_import',
          lineItems: [],
        });
        count++;
      } catch (e) {
        console.warn('Failed to import transaction:', e);
      }
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
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] bg-[#1A1A1A]/50 backdrop-blur-sm flex items-end"
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={SPRING_DEFAULT}
        className="bg-[#F8F4EE] rounded-t-[28px] w-full max-h-[92dvh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-serif text-[22px] text-[#1A1A1A]">Import Bank Statement</h2>
            <p className="font-outfit text-[13px] text-[#6B6560] mt-0.5">CommBank, NAB, ANZ, Westpac + more</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center">
            <X size={18} className="text-[#1A1A1A]" />
          </button>
        </div>

        {/* Drag handle */}
        <div className="w-10 h-1 bg-[#D4CEC4] rounded-full mx-auto mb-2 flex-shrink-0" />

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          <AnimatePresence mode="wait">

            {/* STEP: UPLOAD */}
            {step === 'upload' && (
              <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".csv,.pdf,.ofx,.qif"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />

                <motion.div
                  whileTap={{ scale: 0.98 }}
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-[#D4CEC4] rounded-2xl p-12 flex flex-col items-center justify-center cursor-pointer hover:border-[#B8955A] hover:bg-[#B8955A]/5 transition-colors mt-4"
                >
                  <div className="w-16 h-16 rounded-full bg-[#EDE8DF] flex items-center justify-center mb-4">
                    <Upload size={28} className="text-[#B8955A]" />
                  </div>
                  <h3 className="font-serif text-[18px] text-[#1A1A1A] mb-2">Choose file</h3>
                  <p className="font-outfit text-[13px] text-[#6B6560] text-center">
                    CSV or PDF bank statement<br />CommBank · NAB · ANZ · Westpac · Macquarie · ING
                  </p>
                </motion.div>

                {error && (
                  <div className="mt-4 p-4 bg-[#FDF0EE] border border-[#E8A090] rounded-2xl flex items-center gap-3">
                    <AlertTriangle size={16} className="text-[#C47B6A] flex-shrink-0" />
                    <p className="font-outfit text-[13px] text-[#C47B6A]">{error}</p>
                  </div>
                )}

                {/* Supported formats */}
                <div className="mt-8 space-y-2">
                  <p className="font-outfit text-[11px] uppercase tracking-widest text-[#B8955A] mb-3">Supported formats</p>
                  {['CommBank CSV (Date, Amount, Description)', 'NAB CSV (all formats)', 'ANZ CSV', 'Westpac CSV', 'Any bank PDF statement (AI-powered)', 'Generic CSV with date + amount'].map(f => (
                    <div key={f} className="flex items-center gap-2">
                      <Check size={12} className="text-[#4CAF50]" />
                      <span className="font-outfit text-[13px] text-[#6B6560]">{f}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* STEP: PREVIEW (loading) */}
            {step === 'preview' && transactions.length === 0 && (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center pt-16">
                <div className="w-16 h-16 rounded-full bg-[#EDE8DF] flex items-center justify-center mb-6">
                  <Loader2 size={28} className="text-[#B8955A] animate-spin" />
                </div>
                <h3 className="font-serif text-[20px] text-[#1A1A1A] mb-2">Reading your statement</h3>
                <p className="font-outfit text-[13px] text-[#6B6560] mb-6">Categorizing transactions...</p>
                <div className="w-full h-1.5 bg-[#D4CEC4] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-[#B8955A] rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${processingProgress}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                  />
                </div>
                <p className="font-outfit text-[12px] text-[#B8955A] mt-2">{Math.round(processingProgress)}%</p>
              </motion.div>
            )}

            {/* STEP: PREVIEW (results) */}
            {step === 'preview' && transactions.length > 0 && (
              <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {/* Summary */}
                <div className="bg-[#EDE8DF] rounded-2xl p-4 mb-4 mt-2">
                  <p className="font-serif text-[18px] text-[#1A1A1A]">
                    Found <span className="text-[#B8955A]">{transactions.length}</span> transactions
                  </p>
                  <div className="flex gap-4 mt-2">
                    <span className="font-outfit text-[12px] text-[#4CAF50]">{stats.income} income</span>
                    <span className="font-outfit text-[12px] text-[#C47B6A]">{stats.expenses} expenses</span>
                    {stats.duplicates > 0 && (
                      <span className="font-outfit text-[12px] text-[#FF9800]">{stats.duplicates} duplicates</span>
                    )}
                  </div>
                </div>

                {/* Filter tabs */}
                <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar pb-1">
                  {([
                    { key: 'all', label: `All (${transactions.length})` },
                    { key: 'expenses', label: `Expenses (${stats.expenses})` },
                    { key: 'income', label: `Income (${stats.income})` },
                    ...(stats.duplicates > 0 ? [{ key: 'duplicates', label: `Duplicates (${stats.duplicates})` }] : []),
                  ] as const).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setActiveFilter(tab.key as any)}
                      className={`px-4 py-2 rounded-full font-outfit text-[12px] whitespace-nowrap transition-colors ${
                        activeFilter === tab.key
                          ? 'bg-[#1A1A1A] text-white'
                          : 'bg-[#EDE8DF] text-[#6B6560]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Select all */}
                <div className="flex items-center justify-between mb-3">
                  <button
                    className="font-outfit text-[12px] text-[#B8955A]"
                    onClick={() => setTransactions(prev => prev.map(t => ({ ...t, selected: true })))}
                  >
                    Select all
                  </button>
                  <button
                    className="font-outfit text-[12px] text-[#6B6560]"
                    onClick={() => setTransactions(prev => prev.map(t => ({ ...t, selected: false })))}
                  >
                    Deselect all
                  </button>
                </div>

                {/* Transaction list */}
                <div className="space-y-2 mb-6">
                  {filtered.map(tx => {
                    const catDef = getCategoryDef(tx.category);
                    return (
                      <motion.div
                        key={tx.id}
                        layout
                        className={`flex items-center gap-3 p-3 rounded-2xl border transition-colors cursor-pointer ${
                          tx.selected
                            ? 'bg-[#EDE8DF] border-[#D4CEC4]'
                            : 'bg-[#F8F4EE] border-[#D4CEC4]/50 opacity-50'
                        } ${tx.isDuplicate ? 'border-[#FF9800]/50' : ''}`}
                        onClick={() => setTransactions(prev =>
                          prev.map(t => t.id === tx.id ? { ...t, selected: !t.selected } : t)
                        )}
                      >
                        {/* Category emoji */}
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-[16px] flex-shrink-0"
                          style={{ background: catDef.light }}
                        >
                          {tx.type === 'credit' ? '💰' : catDef.emoji}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="font-outfit text-[13px] text-[#1A1A1A] truncate font-medium">
                            {tx.cleanDescription || tx.description}
                          </p>
                          <p className="font-outfit text-[11px] text-[#6B6560]">
                            {tx.date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                            {tx.isDuplicate && <span className="ml-2 text-[#FF9800]">⚠ Possibly already scanned</span>}
                          </p>
                        </div>

                        {/* Amount */}
                        <p className={`font-serif text-[15px] font-light flex-shrink-0 ${
                          tx.type === 'credit' ? 'text-[#4CAF50]' : 'text-[#1A1A1A]'
                        }`}>
                          {tx.type === 'credit' ? '+' : ''}{formatAUD(Math.abs(tx.amount))}
                        </p>

                        {/* Checkbox */}
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          tx.selected ? 'bg-[#B8955A] border-[#B8955A]' : 'border-[#D4CEC4]'
                        }`}>
                          {tx.selected && <Check size={10} className="text-white" />}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Import button */}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleImport}
                  disabled={stats.selected === 0}
                  className={`w-full h-14 rounded-full font-outfit font-semibold text-[15px] transition-all ${
                    stats.selected > 0
                      ? 'bg-[#1A1A1A] text-white shadow-lg'
                      : 'bg-[#D4CEC4] text-white cursor-not-allowed'
                  }`}
                >
                  Import {stats.selected} transaction{stats.selected !== 1 ? 's' : ''}
                </motion.button>
              </motion.div>
            )}

            {/* STEP: IMPORTING */}
            {step === 'importing' && (
              <motion.div key="importing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center pt-16">
                <Loader2 size={48} className="text-[#B8955A] animate-spin mb-6" />
                <h3 className="font-serif text-[20px] text-[#1A1A1A] mb-2">Importing...</h3>
                <p className="font-outfit text-[13px] text-[#6B6560]">Saving {stats.selected} transactions</p>
              </motion.div>
            )}

            {/* STEP: DONE */}
            {step === 'done' && (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING_BOUNCY} className="flex flex-col items-center justify-center pt-12 text-center">
                <div className="w-20 h-20 rounded-full bg-[#E8F5E9] flex items-center justify-center mb-6">
                  <Check size={36} className="text-[#4CAF50]" />
                </div>
                <h3 className="font-serif text-[24px] text-[#1A1A1A] mb-2">Imported!</h3>
                <p className="font-outfit text-[15px] text-[#6B6560] mb-8">
                  {importedCount} transactions added to your finances
                </p>
                <button
                  onClick={onClose}
                  className="w-full h-14 rounded-full bg-[#1A1A1A] text-white font-outfit font-semibold text-[15px]"
                >
                  Done
                </button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
