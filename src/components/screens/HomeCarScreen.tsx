/**
 * OurSpace — Home & Car Maintenance Screen
 * Track all maintenance tasks for your home and vehicles with reminders.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Plus, X, Trash2, Check, AlertTriangle, Home, Car, Wrench } from 'lucide-react';
import {
  collection, query, onSnapshot, addDoc, deleteDoc, doc,
  updateDoc, serverTimestamp, orderBy, Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../AuthWrapper';
import { format, addDays, addMonths, addYears, differenceInDays, isPast } from 'date-fns';
import { SPRING_DEFAULT, SPRING_BOUNCY, haptic } from '../../lib/motion';

// ============================================================
// TYPES
// ============================================================
interface MaintenanceTask {
  id: string;
  title: string;
  category: 'home' | 'car' | 'garden' | 'appliance';
  nextDue: Date;
  intervalType: 'days' | 'months' | 'years';
  intervalValue: number;
  notes?: string;
  estimatedCost?: number;
  completedAt?: Date | null;
  vehicleOrLocation?: string;
}

// ============================================================
// TASK PRESETS
// ============================================================
const PRESETS: Array<Omit<MaintenanceTask, 'id' | 'nextDue' | 'completedAt'>> = [
  { title: 'Air filter replacement', category: 'car', intervalType: 'months', intervalValue: 12, notes: 'Check owner manual for correct filter type', estimatedCost: 50 },
  { title: 'Oil change', category: 'car', intervalType: 'months', intervalValue: 6, notes: 'Full synthetic recommended', estimatedCost: 120 },
  { title: 'Tyre rotation', category: 'car', intervalType: 'months', intervalValue: 6, estimatedCost: 60 },
  { title: 'Car registration', category: 'car', intervalType: 'years', intervalValue: 1 },
  { title: 'CTP insurance renewal', category: 'car', intervalType: 'years', intervalValue: 1 },
  { title: 'HVAC filter replacement', category: 'home', intervalType: 'months', intervalValue: 3, estimatedCost: 30 },
  { title: 'Smoke alarm battery', category: 'home', intervalType: 'years', intervalValue: 1 },
  { title: 'Gutter cleaning', category: 'home', intervalType: 'months', intervalValue: 6, estimatedCost: 200 },
  { title: 'Home insurance renewal', category: 'home', intervalType: 'years', intervalValue: 1 },
  { title: 'Lawn mowing', category: 'garden', intervalType: 'days', intervalValue: 14 },
  { title: 'Washing machine clean', category: 'appliance', intervalType: 'months', intervalValue: 1 },
  { title: 'Dishwasher filter clean', category: 'appliance', intervalType: 'months', intervalValue: 1 },
];

const CATEGORY_META = {
  home:      { emoji: '🏠', color: '#B8955A', label: 'Home' },
  car:       { emoji: '🚗', color: '#2196F3', label: 'Car' },
  garden:    { emoji: '🌿', color: '#4CAF50', label: 'Garden' },
  appliance: { emoji: '⚙️', color: '#607D8B', label: 'Appliance' },
};

// ============================================================
// ADD TASK SHEET
// ============================================================
function AddTaskSheet({ onClose, onAdd }: { onClose: () => void; onAdd: (data: Omit<MaintenanceTask, 'id'>) => void }) {
  const [mode, setMode] = useState<'presets' | 'custom'>('presets');
  const [category, setCategory] = useState<MaintenanceTask['category']>('home');
  const [title, setTitle] = useState('');
  const [intervalType, setIntervalType] = useState<MaintenanceTask['intervalType']>('months');
  const [intervalValue, setIntervalValue] = useState('1');
  const [nextDue, setNextDue] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [cost, setCost] = useState('');

  const handlePreset = (preset: typeof PRESETS[0]) => {
    setTitle(preset.title);
    setCategory(preset.category);
    setIntervalType(preset.intervalType);
    setIntervalValue(String(preset.intervalValue));
    if (preset.estimatedCost) setCost(String(preset.estimatedCost));
    setMode('custom');
  };

  const handleSave = () => {
    if (!title) return;
    onAdd({
      title,
      category,
      nextDue: new Date(nextDue),
      intervalType,
      intervalValue: parseInt(intervalValue) || 1,
      notes: '',
      estimatedCost: cost ? parseFloat(cost) : undefined,
      completedAt: null,
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
        className="bg-[#F8F4EE] rounded-t-[28px] w-full max-h-[88dvh] flex flex-col"
      >
        <div className="px-6 pt-5 pb-4 flex items-center justify-between flex-shrink-0">
          <div>
            {mode === 'custom' && <button onClick={() => setMode('presets')}><span className="font-outfit text-[12px] text-[#B8955A]">← Presets</span></button>}
            <h2 className="font-serif text-[20px] text-[#1A1A1A]">Add Task</h2>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          <AnimatePresence mode="wait">
            {mode === 'presets' && (
              <motion.div key="presets" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="font-outfit text-[13px] text-[#6B6560] mb-4">Choose a common task or create your own</p>
                <div className="space-y-2 mb-4">
                  {PRESETS.map(preset => {
                    const meta = CATEGORY_META[preset.category];
                    return (
                      <motion.button
                        key={preset.title}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => handlePreset(preset)}
                        className="w-full flex items-center gap-3 p-3.5 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl text-left"
                      >
                        <span className="text-[18px]">{meta.emoji}</span>
                        <div className="flex-1">
                          <p className="font-outfit text-[13px] text-[#1A1A1A]">{preset.title}</p>
                          <p className="font-outfit text-[11px] text-[#6B6560]">Every {preset.intervalValue} {preset.intervalType}</p>
                        </div>
                        {preset.estimatedCost && (
                          <span className="font-outfit text-[12px] text-[#6B6560]">~${preset.estimatedCost}</span>
                        )}
                      </motion.button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setMode('custom')}
                  className="w-full h-12 rounded-full border border-[#D4CEC4] font-outfit text-[14px] text-[#6B6560]"
                >
                  Create custom task
                </button>
              </motion.div>
            )}

            {mode === 'custom' && (
              <motion.div key="custom" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                {/* Category */}
                <div>
                  <label className="font-outfit text-[11px] uppercase tracking-widest text-[#B8955A] block mb-2">Category</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(Object.keys(CATEGORY_META) as MaintenanceTask['category'][]).map(cat => {
                      const m = CATEGORY_META[cat];
                      return (
                        <button
                          key={cat}
                          onClick={() => setCategory(cat)}
                          className={`p-3 rounded-xl flex flex-col items-center gap-1 border transition-colors ${
                            category === cat ? 'bg-[#1A1A1A] border-[#1A1A1A]' : 'bg-[#EDE8DF] border-[#D4CEC4]'
                          }`}
                        >
                          <span className="text-[18px]">{m.emoji}</span>
                          <span className={`font-outfit text-[10px] ${category === cat ? 'text-white' : 'text-[#6B6560]'}`}>{m.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Title */}
                <div>
                  <label className="font-outfit text-[11px] uppercase tracking-widest text-[#B8955A] block mb-2">Task name</label>
                  <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. Oil change"
                    className="w-full h-14 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl px-4 font-outfit text-[15px] text-[#1A1A1A] placeholder-[#A8A29E]"
                  />
                </div>

                {/* Interval */}
                <div>
                  <label className="font-outfit text-[11px] uppercase tracking-widest text-[#B8955A] block mb-2">Repeat every</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={intervalValue}
                      onChange={e => setIntervalValue(e.target.value)}
                      min="1"
                      className="w-20 h-12 bg-[#EDE8DF] border border-[#D4CEC4] rounded-xl px-3 font-outfit text-[15px] text-[#1A1A1A] text-center"
                    />
                    <select
                      value={intervalType}
                      onChange={e => setIntervalType(e.target.value as any)}
                      className="flex-1 h-12 bg-[#EDE8DF] border border-[#D4CEC4] rounded-xl px-3 font-outfit text-[14px] text-[#1A1A1A]"
                    >
                      <option value="days">Days</option>
                      <option value="months">Months</option>
                      <option value="years">Years</option>
                    </select>
                  </div>
                </div>

                {/* Next due */}
                <div>
                  <label className="font-outfit text-[11px] uppercase tracking-widest text-[#B8955A] block mb-2">Next due date</label>
                  <input
                    type="date"
                    value={nextDue}
                    onChange={e => setNextDue(e.target.value)}
                    className="w-full h-14 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl px-4 font-outfit text-[15px] text-[#1A1A1A]"
                  />
                </div>

                {/* Cost */}
                <div>
                  <label className="font-outfit text-[11px] uppercase tracking-widest text-[#B8955A] block mb-2">Estimated cost (optional)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-outfit text-[14px] text-[#6B6560]">$</span>
                    <input
                      type="number"
                      value={cost}
                      onChange={e => setCost(e.target.value)}
                      placeholder="0"
                      className="w-full h-14 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl pl-8 pr-4 font-outfit text-[15px] text-[#1A1A1A]"
                    />
                  </div>
                </div>

                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSave}
                  className="w-full h-14 rounded-full bg-[#1A1A1A] text-white font-outfit text-[15px] font-semibold"
                >
                  Add Task
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
export default function HomeCarScreen({ onBack }: { onBack: () => void }) {
  const { householdId } = useAuth();
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [filterCat, setFilterCat] = useState<'all' | MaintenanceTask['category']>('all');

  useEffect(() => {
    if (!householdId) return;
    const q = query(collection(db, `households/${householdId}/maintenanceTasks`), orderBy('nextDue', 'asc'));
    return onSnapshot(q, snap => {
      setTasks(snap.docs.map(d => {
        const raw = d.data();
        return {
          id: d.id,
          ...raw,
          nextDue: raw.nextDue instanceof Timestamp ? raw.nextDue.toDate() : new Date(raw.nextDue),
          completedAt: raw.completedAt ? (raw.completedAt instanceof Timestamp ? raw.completedAt.toDate() : new Date(raw.completedAt)) : null,
        } as MaintenanceTask;
      }));
      setLoading(false);
    });
  }, [householdId]);

  const handleAdd = async (data: Omit<MaintenanceTask, 'id'>) => {
    if (!householdId) return;
    await addDoc(collection(db, `households/${householdId}/maintenanceTasks`), {
      ...data,
      createdAt: serverTimestamp(),
    });
    haptic.success();
  };

  const handleComplete = async (task: MaintenanceTask) => {
    if (!householdId) return;
    // Calculate next due date
    let next = new Date();
    if (task.intervalType === 'days')   next = addDays(next, task.intervalValue);
    if (task.intervalType === 'months') next = addMonths(next, task.intervalValue);
    if (task.intervalType === 'years')  next = addYears(next, task.intervalValue);

    await updateDoc(doc(db, `households/${householdId}/maintenanceTasks`, task.id), {
      nextDue: next,
      completedAt: serverTimestamp(),
    });
    haptic.success();
  };

  const handleDelete = async (id: string) => {
    if (!householdId || !window.confirm('Delete task?')) return;
    await deleteDoc(doc(db, `households/${householdId}/maintenanceTasks`, id));
  };

  const filtered = filterCat === 'all' ? tasks : tasks.filter(t => t.category === filterCat);
  const overdueCount = tasks.filter(t => isPast(t.nextDue)).length;

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={SPRING_DEFAULT}
      className="fixed inset-0 z-[150] bg-[#F8F4EE] flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-[#D4CEC4] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h2 className="font-serif text-[22px] text-[#1A1A1A]">Home & Car</h2>
            <p className="font-outfit text-[12px] text-[#6B6560]">
              Maintenance tracker{overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}
            </p>
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

      {/* Filter tabs */}
      <div className="px-5 py-3 flex gap-2 overflow-x-auto no-scrollbar border-b border-[#D4CEC4] flex-shrink-0">
        {(['all', 'home', 'car', 'garden', 'appliance'] as const).map(cat => (
          <button
            key={cat}
            onClick={() => setFilterCat(cat)}
            className={`px-4 py-2 rounded-full font-outfit text-[12px] whitespace-nowrap flex gap-1.5 items-center flex-shrink-0 transition-colors ${
              filterCat === cat ? 'bg-[#1A1A1A] text-white' : 'bg-[#EDE8DF] text-[#6B6560]'
            }`}
          >
            {cat !== 'all' && <span>{CATEGORY_META[cat]?.emoji}</span>}
            <span className="capitalize">{cat}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center pt-12">
            <div className="w-8 h-8 border-2 border-[#B8955A] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-[48px] mb-4">🔧</div>
            <h3 className="font-serif text-[22px] text-[#1A1A1A] mb-2">No tasks yet</h3>
            <p className="font-outfit text-[13px] text-[#6B6560] mb-6">Track home and car maintenance so nothing gets missed</p>
            <motion.button whileTap={{ scale: 0.95 }} onClick={() => setShowAdd(true)} className="px-6 h-12 rounded-full bg-[#1A1A1A] text-white font-outfit text-[14px] font-semibold">
              Add task
            </motion.button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(task => {
              const meta = CATEGORY_META[task.category];
              const daysToGo  = differenceInDays(task.nextDue, new Date());
              const isOverdue = isPast(task.nextDue);
              const isDueSoon = !isOverdue && daysToGo <= 7;

              return (
                <div
                  key={task.id}
                  className={`p-4 rounded-2xl border flex items-center gap-3 ${
                    isOverdue ? 'bg-[#FDF0EE] border-[#E8A090]' :
                    isDueSoon ? 'bg-[#FFF9F0] border-[#F0E4CC]' :
                    'bg-[#EDE8DF] border-[#D4CEC4]'
                  }`}
                >
                  <div
                    className="w-11 h-11 rounded-2xl flex items-center justify-center text-[18px] flex-shrink-0"
                    style={{ background: meta.color + '22' }}
                  >
                    {meta.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-outfit text-[14px] font-semibold text-[#1A1A1A]">{task.title}</p>
                    <p className={`font-outfit text-[12px] ${isOverdue ? 'text-[#C47B6A] font-semibold' : 'text-[#6B6560]'}`}>
                      {isOverdue
                        ? `Overdue by ${Math.abs(daysToGo)} days`
                        : daysToGo === 0 ? 'Due today'
                        : daysToGo === 1 ? 'Due tomorrow'
                        : `Due ${format(task.nextDue, 'd MMM yyyy')}`}
                    </p>
                    {task.estimatedCost && (
                      <p className="font-outfit text-[11px] text-[#A8A29E]">~${task.estimatedCost}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <motion.button
                      whileTap={{ scale: 0.88 }}
                      onClick={() => handleComplete(task)}
                      className="w-9 h-9 rounded-full bg-[#1A1A1A] flex items-center justify-center"
                    >
                      <Check size={14} className="text-white" />
                    </motion.button>
                    <button onClick={() => handleDelete(task.id)}>
                      <Trash2 size={14} className="text-[#6B6560]" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showAdd && <AddTaskSheet onClose={() => setShowAdd(false)} onAdd={handleAdd} />}
      </AnimatePresence>
    </motion.div>
  );
}
