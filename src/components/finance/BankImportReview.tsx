/**
 * BankImportReview — shows parsed transactions for user review.
 *
 * Features:
 * - Groups by date, shows all pending_review transactions
 * - Needs-clarification row: tap → pick category once → saved to merchant cache forever
 * - Failed pages banner with manual Retry button
 * - Select / deselect individual transactions
 * - Confirm → moves to expenses/bankTransactions, marks import completed
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Check, AlertTriangle, Loader2, RefreshCw,
  ChevronDown, TrendingDown, TrendingUp,
} from 'lucide-react';
import { useAuth } from '../AuthWrapper';
import { db } from '../../firebase';
import {
  collection, onSnapshot, query, orderBy, doc, updateDoc, getDoc,
} from 'firebase/firestore';
import { getCategoryDef } from '../../design/tokens';
import { formatAUD } from '../../lib/cashflow';
import { SPRING_DEFAULT, SPRING_BOUNCY } from '../../lib/motion';
import {
  BankImport, RawImportTx,
  retryFailedPages, confirmImportTransactions,
} from '../../lib/bankImport';
import { confirmMerchantCategory } from '../../lib/merchantCache';
import { format } from 'date-fns';

interface Props {
  bankImport: BankImport;
  onClose: () => void;
  onConfirmed: (count: number) => void;
}

const CATEGORY_OPTIONS = [
  'groceries', 'dining', 'transport', 'entertainment', 'health',
  'shopping', 'utilities', 'rent', 'subscription', 'insurance',
  'education', 'travel', 'personal_care', 'home',
  'salary', 'freelance', 'investment', 'refund', 'transfer', 'other',
];

export default function BankImportReview({ bankImport, onClose, onConfirmed }: Props) {
  const { householdId, user } = useAuth();
  const [transactions, setTransactions] = useState<RawImportTx[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [clarifyingId, setClarifyingId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'expenses' | 'income' | 'unclear'>('all');
  const [importStatus, setImportStatus] = useState<BankImport['status']>(bankImport.status);
  const [failedPages, setFailedPages] = useState<number[]>(bankImport.failedPages ?? []);

  // Listen to raw transactions in real-time (updates as background AI parses)
  useEffect(() => {
    if (!householdId) return;
    const path = `households/${householdId}/bankImports/${bankImport.id}/rawTransactions`;
    const unsub = onSnapshot(
      query(collection(db, path), orderBy('date', 'desc')),
      snap => {
        const txs: RawImportTx[] = snap.docs
          .filter(d => d.data().status === 'pending_review')
          .map(d => {
            const data = d.data();
            const dateVal = data.date?.toDate?.() ?? new Date((data.date?.seconds ?? 0) * 1000 || Date.now());
            return {
              id: d.id,
              importId: bankImport.id,
              date: dateVal,
              description: data.description ?? '',
              cleanDescription: data.cleanDescription ?? data.description ?? '',
              amount: data.amount ?? 0,
              type: data.type ?? 'debit',
              category: data.category ?? 'other',
              subcategory: data.subcategory ?? undefined,
              fromCache: data.fromCache ?? false,
              needsClarification: data.needsClarification ?? false,
              pageSource: data.pageSource ?? 0,
              status: data.status ?? 'pending_review',
              incomeType: data.incomeType,
              balance: data.balance,
            } as RawImportTx;
          });
        setTransactions(txs);
        // Auto-select everything except income that needs clarification
        setSelected(prev => {
          const next = new Set(prev);
          txs.forEach(tx => { if (!prev.has(tx.id)) next.add(tx.id); });
          return next;
        });
        setLoading(false);
      }
    );
    return () => unsub();
  }, [householdId, bankImport.id]);

  // Listen to import doc status (catches when background AI finishes)
  useEffect(() => {
    if (!householdId) return;
    const unsub = onSnapshot(
      doc(db, `households/${householdId}/bankImports/${bankImport.id}`),
      snap => {
        if (!snap.exists()) return;
        setImportStatus(snap.data().status as BankImport['status']);
        setFailedPages(snap.data().failedPages ?? []);
      }
    );
    return () => unsub();
  }, [householdId, bankImport.id]);

  const handleConfirm = async () => {
    if (!householdId || !user || confirming) return;
    setConfirming(true);
    try {
      const count = await confirmImportTransactions(
        bankImport.id, householdId, user.uid, [...selected]
      );
      onConfirmed(count);
    } catch { /* ignore */ }
    setConfirming(false);
  };

  const handleRetry = async () => {
    if (!householdId || retrying) return;
    setRetrying(true);
    await retryFailedPages(bankImport.id, householdId).catch(() => {});
    setRetrying(false);
  };

  // Clarification: user picks category for an unclear income/expense
  const handleClarify = async (txId: string, category: string) => {
    if (!householdId) return;
    const tx = transactions.find(t => t.id === txId);
    if (!tx) return;
    // Save to merchant cache
    await confirmMerchantCategory(householdId, tx.cleanDescription || tx.description, category);
    // Update the raw transaction
    await updateDoc(
      doc(db, `households/${householdId}/bankImports/${bankImport.id}/rawTransactions/${txId}`),
      { category, needsClarification: false }
    ).catch(() => {});
    setClarifyingId(null);
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filtered = transactions.filter(t => {
    if (activeFilter === 'expenses') return t.type === 'debit';
    if (activeFilter === 'income')   return t.type === 'credit';
    if (activeFilter === 'unclear')  return t.needsClarification;
    return true;
  });

  const stats = {
    expenses: transactions.filter(t => t.type === 'debit').length,
    income:   transactions.filter(t => t.type === 'credit').length,
    unclear:  transactions.filter(t => t.needsClarification).length,
    totalSpent:  transactions.filter(t => t.type === 'debit' && selected.has(t.id)).reduce((s, t) => s + t.amount, 0),
    totalIncome: transactions.filter(t => t.type === 'credit' && selected.has(t.id)).reduce((s, t) => s + t.amount, 0),
  };

  const isProcessing = importStatus === 'ai_parsing' || importStatus === 'extracting' || importStatus === 'categorising';

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={SPRING_DEFAULT}
      className="fixed inset-0 z-[300] bg-[#fcf9f4] flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-3 border-b border-[#EDE8DF] flex-shrink-0">
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center">
          <X size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-[20px] text-[#1A1A1A] truncate">Review Import</h2>
          <p className="font-outfit text-[11px] text-[#6B6560] truncate">{bankImport.fileName}</p>
        </div>
        {isProcessing && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#FFF8F0] border border-[#B8955A]/30 rounded-full">
            <Loader2 size={11} className="text-[#B8955A] animate-spin" />
            <span className="font-outfit text-[11px] text-[#B8955A]">Processing…</span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* Processing banner */}
        {isProcessing && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="mx-5 mt-4 p-4 bg-[#FFF8F0] border border-[#B8955A]/30 rounded-2xl flex items-start gap-3">
            <Loader2 size={15} className="text-[#B8955A] animate-spin flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-outfit text-[13px] text-[#B8955A] font-semibold">Gemini 2.5 is reading your statement</p>
              <p className="font-outfit text-[11px] text-[#6B6560] mt-0.5">
                Transactions appear below as each batch finishes. You can review early ones now.
              </p>
            </div>
          </motion.div>
        )}

        {/* Failed pages banner */}
        {failedPages.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="mx-5 mt-3 p-4 bg-[#FDF0EE] border border-[#C47B6A]/30 rounded-2xl flex items-center gap-3">
            <AlertTriangle size={15} className="text-[#C47B6A] flex-shrink-0" />
            <div className="flex-1">
              <p className="font-outfit text-[12px] text-[#C47B6A] font-semibold">
                {failedPages.length} page chunk{failedPages.length > 1 ? 's' : ''} failed
              </p>
              <p className="font-outfit text-[11px] text-[#C47B6A]/80">
                Tap Retry — only the failed pages will be re-sent to AI
              </p>
            </div>
            <motion.button whileTap={{ scale: 0.95 }} onClick={handleRetry} disabled={retrying}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#C47B6A] text-white rounded-full font-outfit text-[12px] font-semibold">
              {retrying ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Retry
            </motion.button>
          </motion.div>
        )}

        {/* Needs clarification banner */}
        {stats.unclear > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="mx-5 mt-3 p-3.5 bg-[#EDE8DF] rounded-2xl flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#B8955A]/20 flex items-center justify-center flex-shrink-0 text-[14px]">?</div>
            <div className="flex-1">
              <p className="font-outfit text-[12px] text-[#1A1A1A] font-semibold">
                {stats.unclear} transaction{stats.unclear > 1 ? 's' : ''} need a category
              </p>
              <p className="font-outfit text-[11px] text-[#6B6560]">
                Tap to assign once — remembered forever for this merchant
              </p>
            </div>
            <button onClick={() => setActiveFilter('unclear')}
              className="font-outfit text-[11px] text-[#B8955A] bg-[#B8955A]/15 px-2 py-1 rounded-full">View</button>
          </motion.div>
        )}

        {/* Summary */}
        {transactions.length > 0 && (
          <div className="mx-5 mt-4 bg-[#1A1A1A] rounded-[22px] p-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#B8955A] opacity-10 blur-3xl rounded-full pointer-events-none" />
            <div className="relative z-10">
              <p className="font-outfit text-[10px] uppercase tracking-[2px] text-[#B8955A] mb-2">
                {transactions.length} transactions · {selected.size} selected
              </p>
              <div className="flex gap-5">
                <div>
                  <div className="flex items-center gap-1 mb-0.5">
                    <TrendingDown size={11} className="text-[#C47B6A]" />
                    <span className="font-outfit text-[10px] text-white/40 uppercase">Expenses</span>
                  </div>
                  <p className="font-serif text-[18px] text-white">{formatAUD(stats.totalSpent)}</p>
                </div>
                <div>
                  <div className="flex items-center gap-1 mb-0.5">
                    <TrendingUp size={11} className="text-[#7FAF7B]" />
                    <span className="font-outfit text-[10px] text-white/40 uppercase">Income</span>
                  </div>
                  <p className="font-serif text-[18px] text-[#7FAF7B]">{formatAUD(stats.totalIncome)}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        {transactions.length > 0 && (
          <div className="flex gap-2 px-5 mt-4 overflow-x-auto no-scrollbar pb-1">
            {([
              { key: 'all',      label: `All (${transactions.length})` },
              { key: 'expenses', label: `Expenses (${stats.expenses})` },
              { key: 'income',   label: `Income (${stats.income})` },
              ...(stats.unclear > 0 ? [{ key: 'unclear', label: `Unclear (${stats.unclear})` }] : []),
            ] as const).map(tab => (
              <button key={tab.key}
                onClick={() => setActiveFilter(tab.key as typeof activeFilter)}
                className={`px-4 py-2 rounded-full font-outfit text-[12px] whitespace-nowrap transition-all ${
                  activeFilter === tab.key ? 'bg-[#1A1A1A] text-white' : 'bg-[#EDE8DF] text-[#6B6560]'
                }`}>
                {tab.label}
              </button>
            ))}
            <div className="flex items-center gap-2 ml-auto">
              <button className="font-outfit text-[11px] text-[#B8955A]"
                onClick={() => setSelected(new Set(transactions.map(t => t.id)))}>All</button>
              <button className="font-outfit text-[11px] text-[#6B6560]"
                onClick={() => setSelected(new Set())}>None</button>
            </div>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="text-[#B8955A] animate-spin" />
          </div>
        )}

        {/* Empty state (processing, not loaded yet) */}
        {!loading && transactions.length === 0 && isProcessing && (
          <div className="flex flex-col items-center py-16 px-8 text-center">
            <Loader2 size={32} className="text-[#B8955A] animate-spin mb-4" />
            <p className="font-outfit text-[14px] text-[#6B6560]">AI is still parsing your statement…</p>
            <p className="font-outfit text-[12px] text-[#A8A29E] mt-1">Transactions will appear here as each batch finishes</p>
          </div>
        )}

        {/* Transaction list */}
        <div className="px-5 mt-4 space-y-2 pb-36">
          <AnimatePresence>
            {filtered.map((tx, idx) => {
              const catDef = getCategoryDef(tx.category);
              const isSel = selected.has(tx.id);
              return (
                <motion.div key={tx.id} layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx * 0.012, 0.25) }}
                >
                  {/* Main row */}
                  <div
                    onClick={() => !tx.needsClarification && toggleSelect(tx.id)}
                    className={`flex items-center gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all ${
                      isSel ? 'bg-[#EDE8DF] border-[#D4CEC4]' : 'bg-white border-[#E8E3DA] opacity-55'
                    } ${tx.needsClarification ? 'border-[#B8955A]/50 bg-[#FFF8F0]' : ''}`}
                  >
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[16px] flex-shrink-0"
                      style={{ background: tx.type === 'credit' ? '#E8F5E9' : catDef.light }}>
                      {tx.needsClarification ? '❓' : tx.type === 'credit' ? '💰' : catDef.emoji}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="font-outfit text-[13px] text-[#1A1A1A] truncate font-medium">
                        {tx.cleanDescription || tx.description}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-outfit text-[11px] text-[#6B6560]">
                          {format(tx.date, 'd MMM yyyy')}
                        </span>
                        {tx.fromCache && (
                          <span className="font-outfit text-[10px] text-[#B8955A] bg-[#B8955A]/10 px-1.5 py-0.5 rounded-full">cached</span>
                        )}
                        {tx.needsClarification && (
                          <span className="font-outfit text-[10px] text-[#B8955A] font-semibold">Needs category</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="text-right">
                        <p className={`font-serif text-[15px] ${tx.type === 'credit' ? 'text-[#4CAF50]' : 'text-[#1A1A1A]'}`}>
                          {tx.type === 'credit' ? '+' : ''}{formatAUD(tx.amount)}
                        </p>
                        <p className="font-outfit text-[10px] text-[#A8A29E]">{catDef.label}</p>
                      </div>

                      {tx.needsClarification ? (
                        <button onClick={() => setClarifyingId(clarifyingId === tx.id ? null : tx.id)}
                          className="w-8 h-8 rounded-full bg-[#B8955A] flex items-center justify-center">
                          <ChevronDown size={14} className={`text-white transition-transform ${clarifyingId === tx.id ? 'rotate-180' : ''}`} />
                        </button>
                      ) : (
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          isSel ? 'bg-[#B8955A] border-[#B8955A]' : 'border-[#D4CEC4]'
                        }`}>
                          {isSel && <Check size={10} className="text-white" strokeWidth={3} />}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Clarification picker */}
                  <AnimatePresence>
                    {clarifyingId === tx.id && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden">
                        <div className="mx-2 mt-1 p-3 bg-[#FFF8F0] border border-[#B8955A]/30 rounded-2xl">
                          <p className="font-outfit text-[11px] text-[#B8955A] font-semibold mb-2">
                            What is "{tx.cleanDescription || tx.description}"?
                          </p>
                          <p className="font-outfit text-[10px] text-[#6B6560] mb-3">
                            Your choice is saved — this merchant will be auto-categorised next time.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {CATEGORY_OPTIONS.map(cat => (
                              <button key={cat} onClick={() => handleClarify(tx.id, cat)}
                                className="px-3 py-1.5 rounded-full bg-[#EDE8DF] border border-[#D4CEC4] font-outfit text-[11px] text-[#1A1A1A] active:bg-[#B8955A] active:text-white active:border-[#B8955A] transition-colors">
                                {getCategoryDef(cat).emoji} {cat}
                              </button>
                            ))}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Sticky confirm button */}
      <AnimatePresence>
        {!loading && transactions.length > 0 && (
          <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }} transition={SPRING_DEFAULT}
            className="flex-shrink-0 px-5 pb-8 pt-4 bg-[#fcf9f4] border-t border-[#EDE8DF]">
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleConfirm}
              disabled={selected.size === 0 || confirming}
              className={`w-full h-14 rounded-full font-outfit font-semibold text-[15px] flex items-center justify-center gap-2 transition-all ${
                selected.size > 0
                  ? 'bg-[#1A1A1A] text-white shadow-xl shadow-black/20'
                  : 'bg-[#D4CEC4] text-white/60 cursor-not-allowed'
              }`}
            >
              {confirming
                ? <><Loader2 size={18} className="animate-spin" /> Saving…</>
                : selected.size > 0
                  ? <><Check size={18} /> Confirm {selected.size} transaction{selected.size !== 1 ? 's' : ''}</>
                  : 'Select transactions to import'
              }
            </motion.button>
            {isProcessing && (
              <p className="font-outfit text-[11px] text-[#A8A29E] text-center mt-2">
                More transactions may still be loading…
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
