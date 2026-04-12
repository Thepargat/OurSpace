/**
 * OurSpace — Subscriptions Screen
 * Track recurring subscriptions + auto-detect from bank imports
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Plus, X, Trash2 } from 'lucide-react';
import {
  collection, query, onSnapshot, addDoc, deleteDoc, doc,
  serverTimestamp, orderBy, Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../AuthWrapper';
import { format, differenceInDays } from 'date-fns';
import { SPRING_DEFAULT, haptic } from '../../lib/motion';
import { formatAUD } from '../../lib/cashflow';

// ============================================================
// TYPES
// ============================================================
interface Subscription {
  id: string;
  name: string;
  amount: number;
  frequency: 'weekly' | 'fortnightly' | 'monthly' | 'yearly';
  nextDate: Date;
  category: string;
  color: string;
  emoji: string;
  notes?: string;
  isAutoDetected?: boolean;
  paused?: boolean;
}

// ============================================================
// COMMON SUBSCRIPTIONS PRESETS
// ============================================================
const PRESETS = [
  { name: 'Netflix', emoji: '📺', color: '#E50914', category: 'entertainment' },
  { name: 'Spotify', emoji: '🎵', color: '#1DB954', category: 'entertainment' },
  { name: 'Disney+', emoji: '✨', color: '#113CCF', category: 'entertainment' },
  { name: 'Stan', emoji: '🎬', color: '#00A752', category: 'entertainment' },
  { name: 'Binge', emoji: '📡', color: '#FF6900', category: 'entertainment' },
  { name: 'Kayo', emoji: '⚽', color: '#FF6900', category: 'entertainment' },
  { name: 'YouTube Premium', emoji: '▶️', color: '#FF0000', category: 'entertainment' },
  { name: 'Apple TV+', emoji: '🍎', color: '#555555', category: 'entertainment' },
  { name: 'iCloud+', emoji: '☁️', color: '#3482F6', category: 'utilities' },
  { name: 'Amazon Prime', emoji: '📦', color: '#FF9900', category: 'shopping' },
  { name: 'ChatGPT Plus', emoji: '🤖', color: '#10A37F', category: 'work_expense' },
  { name: 'Adobe CC', emoji: '🎨', color: '#FF0000', category: 'work_expense' },
  { name: 'Microsoft 365', emoji: '💻', color: '#0078D4', category: 'work_expense' },
  { name: 'Gym', emoji: '💪', color: '#795548', category: 'health' },
  { name: 'Other', emoji: '📱', color: '#9E9E9E', category: 'other' },
];

const FREQUENCY_LABELS: Record<Subscription['frequency'], string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

const monthlyEquivalent = (amount: number, freq: Subscription['frequency']): number => {
  if (freq === 'weekly')       return amount * 52 / 12;
  if (freq === 'fortnightly')  return amount * 26 / 12;
  if (freq === 'monthly')      return amount;
  if (freq === 'yearly')       return amount / 12;
  return amount;
};

// ============================================================
// ADD SUBSCRIPTION SHEET
// ============================================================
function AddSubscriptionSheet({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (data: Omit<Subscription, 'id'>) => void;
}) {
  const [step, setStep] = useState<'preset' | 'details'>('preset');
  const [selected, setSelected] = useState<typeof PRESETS[0] | null>(null);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Subscription['frequency']>('monthly');
  const [nextDate, setNextDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const handlePresetSelect = (preset: typeof PRESETS[0]) => {
    setSelected(preset);
    setName(preset.name);
    setStep('details');
  };

  const handleSave = () => {
    if (!name || !amount || isNaN(parseFloat(amount))) return;
    onAdd({
      name,
      amount: parseFloat(amount),
      frequency,
      nextDate: new Date(nextDate),
      category: selected?.category || 'other',
      color: selected?.color || '#9E9E9E',
      emoji: selected?.emoji || '📱',
      notes: '',
      isAutoDetected: false,
      paused: false,
    });
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] bg-[#1A1A1A]/60 backdrop-blur-sm flex items-end"
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={SPRING_DEFAULT}
        className="bg-[#F8F4EE] rounded-t-[28px] w-full max-h-[85dvh] flex flex-col"
      >
        <div className="px-6 pt-5 pb-4 flex items-center justify-between flex-shrink-0">
          <div>
            {step === 'details' && (
              <button onClick={() => setStep('preset')} className="mb-1">
                <span className="font-outfit text-[12px] text-[#B8955A]">← Back</span>
              </button>
            )}
            <h2 className="font-serif text-[20px] text-[#1A1A1A]">
              {step === 'preset' ? 'Add Subscription' : name}
            </h2>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          <AnimatePresence mode="wait">
            {step === 'preset' && (
              <motion.div key="preset" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="grid grid-cols-3 gap-3">
                  {PRESETS.map(preset => (
                    <motion.button
                      key={preset.name}
                      whileTap={{ scale: 0.92 }}
                      onClick={() => handlePresetSelect(preset)}
                      className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-[#D4CEC4] bg-[#EDE8DF] hover:border-[#B8955A] transition-colors"
                    >
                      <span className="text-[24px]">{preset.emoji}</span>
                      <span className="font-outfit text-[11px] text-[#1A1A1A] text-center leading-tight">{preset.name}</span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {step === 'details' && (
              <motion.div key="details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                {/* Name */}
                <div>
                  <label className="font-outfit text-[11px] uppercase tracking-widest text-[#B8955A] block mb-2">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full h-14 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl px-4 font-outfit text-[15px] text-[#1A1A1A]"
                  />
                </div>

                {/* Amount */}
                <div>
                  <label className="font-outfit text-[11px] uppercase tracking-widest text-[#B8955A] block mb-2">Amount</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-outfit text-[16px] text-[#6B6560]">$</span>
                    <input
                      type="number"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      className="w-full h-14 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl pl-8 pr-4 font-serif text-[20px] text-[#1A1A1A]"
                    />
                  </div>
                </div>

                {/* Frequency */}
                <div>
                  <label className="font-outfit text-[11px] uppercase tracking-widest text-[#B8955A] block mb-2">Billing cycle</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['weekly', 'fortnightly', 'monthly', 'yearly'] as const).map(freq => (
                      <button
                        key={freq}
                        onClick={() => setFrequency(freq)}
                        className={`h-12 rounded-xl font-outfit text-[13px] border transition-colors ${
                          frequency === freq
                            ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                            : 'bg-[#EDE8DF] text-[#1A1A1A] border-[#D4CEC4]'
                        }`}
                      >
                        {FREQUENCY_LABELS[freq]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Next billing date */}
                <div>
                  <label className="font-outfit text-[11px] uppercase tracking-widest text-[#B8955A] block mb-2">Next billing date</label>
                  <input
                    type="date"
                    value={nextDate}
                    onChange={e => setNextDate(e.target.value)}
                    className="w-full h-14 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl px-4 font-outfit text-[15px] text-[#1A1A1A]"
                  />
                </div>

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSave}
                  className="w-full h-14 rounded-full bg-[#1A1A1A] text-white font-outfit text-[15px] font-semibold mt-4"
                >
                  Add Subscription
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// MAIN SCREEN
// ============================================================
export default function SubscriptionsScreen({ onBack }: { onBack: () => void }) {
  const { householdId } = useAuth();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    if (!householdId) return;
    const q = query(
      collection(db, `households/${householdId}/subscriptions`),
      orderBy('nextDate', 'asc')
    );
    return onSnapshot(q, snap => {
      setSubs(snap.docs.map(d => {
        const raw = d.data();
        return {
          id: d.id,
          ...raw,
          nextDate: raw.nextDate instanceof Timestamp ? raw.nextDate.toDate() : new Date(raw.nextDate),
        } as Subscription;
      }));
      setLoading(false);
    });
  }, [householdId]);

  const handleAdd = async (data: Omit<Subscription, 'id'>) => {
    if (!householdId) return;
    await addDoc(collection(db, `households/${householdId}/subscriptions`), {
      ...data,
      createdAt: serverTimestamp(),
    });
    haptic.success();
  };

  const handleDelete = async (id: string) => {
    if (!householdId || !window.confirm('Remove subscription?')) return;
    await deleteDoc(doc(db, `households/${householdId}/subscriptions`, id));
  };

  const totalMonthly = subs
    .filter(s => !s.paused)
    .reduce((sum, s) => sum + monthlyEquivalent(s.amount, s.frequency), 0);

  const totalYearly = totalMonthly * 12;

  // Group by upcoming vs later
  const upcomingSubs = subs.filter(s => differenceInDays(s.nextDate, new Date()) <= 7);
  const laterSubs    = subs.filter(s => differenceInDays(s.nextDate, new Date()) > 7);

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={SPRING_DEFAULT}
      className="fixed inset-0 z-[150] bg-[#F8F4EE] flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-[#D4CEC4] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h2 className="font-serif text-[22px] text-[#1A1A1A]">Subscriptions</h2>
            <p className="font-outfit text-[12px] text-[#6B6560]">Recurring charges</p>
          </div>
        </div>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setShowAdd(true)}
          className="w-10 h-10 rounded-full bg-[#1A1A1A] flex items-center justify-center"
        >
          <Plus size={18} className="text-white" />
        </motion.button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Summary Card */}
        {subs.length > 0 && (
          <div className="bg-[#1A1A1A] rounded-[22px] p-5 mb-5">
            <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A] mb-4">Total Cost</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="font-outfit text-[11px] text-white/40 uppercase tracking-wider">Per Month</p>
                <p className="font-serif text-[28px] font-light text-white mt-1">{formatAUD(totalMonthly)}</p>
              </div>
              <div>
                <p className="font-outfit text-[11px] text-white/40 uppercase tracking-wider">Per Year</p>
                <p className="font-serif text-[28px] font-light text-white mt-1">{formatAUD(totalYearly)}</p>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center pt-12">
            <div className="w-8 h-8 border-2 border-[#B8955A] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : subs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-[48px] mb-4">💳</div>
            <h3 className="font-serif text-[22px] text-[#1A1A1A] mb-2">No subscriptions yet</h3>
            <p className="font-outfit text-[13px] text-[#6B6560] mb-6">Add your recurring charges to track them all in one place</p>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowAdd(true)}
              className="px-6 h-12 rounded-full bg-[#1A1A1A] text-white font-outfit text-[14px] font-semibold"
            >
              Add subscription
            </motion.button>
          </div>
        ) : (
          <>
            {upcomingSubs.length > 0 && (
              <div className="mb-5">
                <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#C47B6A] mb-3">Due Soon</p>
                <div className="space-y-3">
                  {upcomingSubs.map(sub => (
                    <SubscriptionCard key={sub.id} sub={sub} onDelete={() => handleDelete(sub.id)} warning />
                  ))}
                </div>
              </div>
            )}

            {laterSubs.length > 0 && (
              <div>
                <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A] mb-3">Upcoming</p>
                <div className="space-y-3">
                  {laterSubs.map(sub => (
                    <SubscriptionCard key={sub.id} sub={sub} onDelete={() => handleDelete(sub.id)} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <AnimatePresence>
        {showAdd && (
          <AddSubscriptionSheet onClose={() => setShowAdd(false)} onAdd={handleAdd} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function SubscriptionCard({ sub, onDelete, warning }: { sub: Subscription; onDelete: () => void; warning?: boolean }) {
  const daysUntil = differenceInDays(sub.nextDate, new Date());
  const monthlyEq = monthlyEquivalent(sub.amount, sub.frequency);

  return (
    <div className={`p-4 rounded-2xl border flex items-center gap-3 ${warning ? 'bg-[#FDF0EE] border-[#E8A090]' : 'bg-[#EDE8DF] border-[#D4CEC4]'}`}>
      {/* Icon */}
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center text-[20px] flex-shrink-0"
        style={{ background: sub.color + '22', border: `2px solid ${sub.color}33` }}
      >
        {sub.emoji}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="font-outfit text-[14px] font-semibold text-[#1A1A1A]">{sub.name}</p>
        <p className="font-outfit text-[12px] text-[#6B6560]">
          {FREQUENCY_LABELS[sub.frequency]} · {formatAUD(monthlyEq)}/mo
        </p>
        <p className={`font-outfit text-[11px] mt-0.5 ${warning ? 'text-[#C47B6A] font-semibold' : 'text-[#A8A29E]'}`}>
          {daysUntil === 0 ? 'Due today' : daysUntil === 1 ? 'Due tomorrow' : `Due ${format(sub.nextDate, 'd MMM')}`}
        </p>
      </div>

      {/* Amount */}
      <div className="text-right flex-shrink-0">
        <p className="font-serif text-[18px] text-[#1A1A1A]">{formatAUD(sub.amount)}</p>
        <button onClick={onDelete} className="mt-1">
          <Trash2 size={12} className="text-[#6B6560]" />
        </button>
      </div>
    </div>
  );
}
