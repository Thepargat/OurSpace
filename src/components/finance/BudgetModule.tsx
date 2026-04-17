/**
 * BudgetModule — per-category budget management
 *
 * Features:
 * - Per-category budget amounts stored in household budgetSettings.categoryBudgets
 * - Auto-suggest: 3-month average + 10% buffer, rounded to nearest $10
 * - Animated progress bars (green < 80%, amber 80-100%, red over)
 * - Tap any category to edit its budget inline
 * - Total summary ring at top
 * - Projected overspend callout
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Check, ChevronDown, Loader2, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { db } from '../../firebase';
import { doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { getCategoryDef } from '../../design/tokens';
import { formatAUD, formatCompact } from '../../lib/cashflow';
import { SPRING_DEFAULT } from '../../lib/motion';

interface Expense {
  id: string;
  total: number;
  date: Date;
  category: string;
}

interface Props {
  householdId: string;
  monthExpenses: Expense[];
  allExpenses: Expense[];
  viewMonth: Date;
}

const BUDGET_CATS = [
  'groceries', 'dining', 'transport', 'health', 'entertainment',
  'utilities', 'shopping', 'personal_care', 'coffee', 'household', 'other',
];

// ── Spend ring (SVG) ───────────────────────────────────────────────────────
function SpendRing({ pct, color, size = 72 }: { pct: number; color: string; size?: number }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct / 100, 1) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EDE8DF" strokeWidth={8} />
      <motion.circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: circ - dash }}
        transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  );
}

// ── Category row ───────────────────────────────────────────────────────────
function CategoryRow({
  cat, budget, actual, idx, onSave,
}: {
  cat: string; budget: number; actual: number; idx: number;
  onSave: (cat: string, value: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const catDef = getCategoryDef(cat);
  const pct = budget > 0 ? (actual / budget) * 100 : 0;
  const isOver = budget > 0 && actual > budget;
  const isNear = budget > 0 && pct >= 80 && !isOver;
  const barColor = isOver ? '#C47B6A' : isNear ? '#FF9800' : catDef.color;
  const bgClass = isOver ? 'bg-[#FDF0EE] border-[#E8A090]/50' : isNear ? 'bg-[#FFF8F0] border-[#B8955A]/30' : 'bg-white border-[#EDE8DF]';

  const handleSave = async () => {
    const v = parseFloat(inputVal);
    if (!isNaN(v) && v >= 0) await onSave(cat, v);
    setEditing(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-[20px] border overflow-hidden ${bgClass}`}
    >
      <motion.button
        className="w-full p-4 text-left"
        whileTap={{ scale: 0.99 }}
        onClick={() => { setEditing(!editing); setInputVal(budget > 0 ? String(budget) : ''); }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[14px] flex items-center justify-center text-[20px] flex-shrink-0"
              style={{ background: catDef.light }}>
              {catDef.emoji}
            </div>
            <div>
              <p className="font-outfit text-[14px] font-semibold text-[#1A1A1A] leading-tight">{catDef.label}</p>
              <p className="font-outfit text-[11px] text-[#6B6560] mt-0.5">
                {budget > 0
                  ? `${formatAUD(actual)} spent · ${formatAUD(budget)} budget`
                  : actual > 0 ? `${formatAUD(actual)} spent · tap to set budget` : 'No spending · tap to set budget'
                }
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isOver && <span className="font-outfit text-[10px] font-bold text-[#C47B6A] bg-[#C47B6A]/10 px-2 py-0.5 rounded-full">Over</span>}
            {isNear && !isOver && <span className="font-outfit text-[10px] font-bold text-[#B8955A] bg-[#B8955A]/10 px-2 py-0.5 rounded-full">Near</span>}
            {budget > 0 && !isOver && !isNear && <span className="font-outfit text-[10px] font-bold text-[#4CAF50] bg-[#4CAF50]/10 px-2 py-0.5 rounded-full">On track</span>}
            <ChevronDown size={14} className={`text-[#A8A29E] transition-transform duration-200 ${editing ? 'rotate-180' : ''}`} />
          </div>
        </div>

        {/* Progress bar */}
        {budget > 0 && (
          <div className="mt-3">
            <div className="h-[5px] bg-[#EDE8DF] rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(pct, 100)}%` }}
                transition={{ duration: 0.9, delay: idx * 0.05 + 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="h-full rounded-full"
                style={{ background: barColor }}
              />
            </div>
            {isOver && (
              <p className="font-outfit text-[11px] text-[#C47B6A] mt-1 font-medium">
                {formatAUD(actual - budget)} over — {Math.round(pct)}% of budget
              </p>
            )}
          </div>
        )}
      </motion.button>

      {/* Edit panel */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 flex items-center gap-3 border-t border-black/[0.05]">
              <div className="flex-1 flex items-center gap-2 bg-[#EDE8DF] rounded-[14px] px-3.5 py-2.5 mt-3">
                <span className="font-outfit text-[14px] text-[#6B6560]">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={inputVal}
                  onChange={e => setInputVal(e.target.value)}
                  placeholder="Monthly budget"
                  className="flex-1 bg-transparent font-outfit text-[15px] text-[#1A1A1A] outline-none placeholder:text-[#A8A29E]"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
                />
              </div>
              <motion.button
                whileTap={{ scale: 0.94 }}
                onClick={handleSave}
                className="w-11 h-11 bg-[#1A1A1A] rounded-[14px] flex items-center justify-center mt-3 flex-shrink-0"
              >
                <Check size={16} className="text-white" />
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function BudgetModule({ householdId, monthExpenses, allExpenses, viewMonth }: Props) {
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestDone, setSuggestDone] = useState(false);

  useEffect(() => {
    if (!householdId) return;
    const unsub = onSnapshot(doc(db, 'households', householdId), snap => {
      setCategoryBudgets(snap.data()?.budgetSettings?.categoryBudgets ?? {});
    });
    return () => unsub();
  }, [householdId]);

  // Actuals for current view month
  const actuals: Record<string, number> = {};
  for (const cat of BUDGET_CATS) {
    actuals[cat] = monthExpenses.filter(e => e.category === cat).reduce((s, e) => s + e.total, 0);
  }

  // Auto-suggest from last 3 months of spending
  const handleAutoSuggest = async () => {
    setSuggesting(true);
    const start = startOfMonth(subMonths(viewMonth, 3));
    const end = endOfMonth(subMonths(viewMonth, 1));
    const recent = allExpenses.filter(e => e.date >= start && e.date <= end);

    const suggestions: Record<string, number> = {};
    for (const cat of BUDGET_CATS) {
      const catTotal = recent.filter(e => e.category === cat).reduce((s, e) => s + e.total, 0);
      if (catTotal > 0) {
        const avgPerMonth = catTotal / 3;
        suggestions[cat] = Math.ceil((avgPerMonth * 1.1) / 10) * 10; // +10% buffer, rounded to $10
      }
    }

    await updateDoc(doc(db, 'households', householdId), {
      'budgetSettings.categoryBudgets': { ...categoryBudgets, ...suggestions },
    });

    setSuggesting(false);
    setSuggestDone(true);
    setTimeout(() => setSuggestDone(false), 2500);
  };

  const handleSaveBudget = async (cat: string, value: number) => {
    const newBudgets = { ...categoryBudgets, [cat]: value };
    await updateDoc(doc(db, 'households', householdId), {
      'budgetSettings.categoryBudgets': newBudgets,
    });
  };

  // Only show cats with budget set or spending this month
  const activeCats = BUDGET_CATS.filter(c => (categoryBudgets[c] ?? 0) > 0 || (actuals[c] ?? 0) > 0);
  const inactiveCats = BUDGET_CATS.filter(c => !activeCats.includes(c));

  const totalBudget = Object.entries(categoryBudgets).filter(([c]) => BUDGET_CATS.includes(c)).reduce((s, [, v]) => s + v, 0);
  const totalActual = activeCats.reduce((s, c) => s + (actuals[c] ?? 0), 0);
  const totalPct = totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0;
  const ringColor = totalPct > 100 ? '#C47B6A' : totalPct > 80 ? '#FF9800' : '#4CAF50';

  // Comparison with previous month
  const prevMonth = subMonths(viewMonth, 1);
  const prevStart = startOfMonth(prevMonth);
  const prevEnd = endOfMonth(prevMonth);
  const prevTotal = allExpenses.filter(e => e.date >= prevStart && e.date <= prevEnd).reduce((s, e) => s + e.total, 0);
  const changePct = prevTotal > 0 ? ((totalActual - prevTotal) / prevTotal) * 100 : 0;

  return (
    <div className="pb-10">
      {/* Header */}
      <div className="px-5 mb-5 flex items-center justify-between">
        <div>
          <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A]">Budget</p>
          <p className="font-serif text-[22px] text-[#1A1A1A] leading-tight">{format(viewMonth, 'MMMM yyyy')}</p>
        </div>
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={handleAutoSuggest}
          disabled={suggesting}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full font-outfit text-[13px] font-semibold transition-colors ${
            suggestDone
              ? 'bg-[#E8F5E9] text-[#2E7D32]'
              : 'bg-[#B8955A]/15 text-[#B8955A]'
          }`}
        >
          {suggesting ? <Loader2 size={13} className="animate-spin" /> : suggestDone ? <Check size={13} /> : <Sparkles size={13} />}
          {suggesting ? 'Calculating…' : suggestDone ? 'Done!' : 'Auto-suggest'}
        </motion.button>
      </div>

      {/* Summary hero */}
      {totalBudget > 0 && (
        <div className="px-5 mb-5">
          <div className="bg-[#1A1A1A] rounded-[28px] p-5 flex items-center gap-5">
            {/* Ring */}
            <div className="relative flex-shrink-0">
              <SpendRing pct={totalPct} color={ringColor} size={80} />
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="font-outfit text-[13px] font-bold text-white">{Math.round(totalPct)}%</p>
              </div>
            </div>
            {/* Stats */}
            <div className="flex-1">
              <p className="font-outfit text-[11px] text-white/40 uppercase tracking-wider mb-1">Total budget used</p>
              <p className="font-serif text-[28px] text-white leading-none">{formatAUD(totalActual)}</p>
              <p className="font-outfit text-[13px] text-white/40 mt-0.5">of {formatAUD(totalBudget)}</p>
              {prevTotal > 0 && (
                <div className="flex items-center gap-1 mt-2">
                  {changePct > 0
                    ? <TrendingUp size={12} className="text-[#C47B6A]" />
                    : changePct < 0
                      ? <TrendingDown size={12} className="text-[#4CAF50]" />
                      : <Minus size={12} className="text-white/40" />
                  }
                  <p className={`font-outfit text-[11px] ${changePct > 0 ? 'text-[#C47B6A]' : changePct < 0 ? 'text-[#7FAF7B]' : 'text-white/40'}`}>
                    {changePct > 0 ? '+' : ''}{Math.round(changePct)}% vs {format(prevMonth, 'MMM')}
                  </p>
                </div>
              )}
            </div>
            {/* Remaining / over */}
            <div className="text-right flex-shrink-0">
              {totalActual <= totalBudget ? (
                <>
                  <p className="font-outfit text-[10px] text-white/40 uppercase">Remaining</p>
                  <p className="font-serif text-[18px] text-[#7FAF7B]">{formatAUD(totalBudget - totalActual)}</p>
                </>
              ) : (
                <>
                  <p className="font-outfit text-[10px] text-[#C47B6A] uppercase">Over by</p>
                  <p className="font-serif text-[18px] text-[#C47B6A]">{formatAUD(totalActual - totalBudget)}</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Category rows */}
      <div className="px-5 space-y-2.5">
        {activeCats.length > 0 ? (
          activeCats.map((cat, i) => (
            <CategoryRow
              key={cat}
              cat={cat}
              budget={categoryBudgets[cat] ?? 0}
              actual={actuals[cat] ?? 0}
              idx={i}
              onSave={handleSaveBudget}
            />
          ))
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-14 text-center"
          >
            <div className="w-20 h-20 rounded-[24px] bg-[#EDE8DF] flex items-center justify-center text-[36px] mb-5">💰</div>
            <h3 className="font-serif text-[20px] text-[#1A1A1A] mb-2">No budgets yet</h3>
            <p className="font-outfit text-[13px] text-[#6B6560] mb-5 max-w-[260px]">
              Tap <strong>Auto-suggest</strong> to build budgets from your last 3 months, or tap a category below to set one manually.
            </p>
          </motion.div>
        )}

        {/* Add unbudgeted categories */}
        {inactiveCats.length > 0 && (
          <div className="pt-2">
            <p className="font-outfit text-[10px] uppercase tracking-[2px] text-[#A8A29E] mb-2.5">Add budget for</p>
            <div className="flex flex-wrap gap-2">
              {inactiveCats.map(cat => {
                const catDef = getCategoryDef(cat);
                return (
                  <motion.button
                    key={cat}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => {
                      // Trigger edit on a phantom CategoryRow by mounting it
                      // Simplest: dispatch a custom event or just inline edit
                      const amount = window.prompt(`Budget for ${catDef.label} ($/month)?`);
                      if (amount !== null) {
                        const v = parseFloat(amount);
                        if (!isNaN(v) && v > 0) handleSaveBudget(cat, v);
                      }
                    }}
                    className="flex items-center gap-1.5 bg-[#EDE8DF] rounded-full px-3 py-1.5"
                  >
                    <span className="text-[13px]">{catDef.emoji}</span>
                    <span className="font-outfit text-[12px] text-[#6B6560]">{catDef.label}</span>
                  </motion.button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
