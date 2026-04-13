import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { Plus, Check, Clock, User, Trash2, ChevronLeft } from 'lucide-react';
import {
  collection,
  query,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  orderBy,
  getDoc,
  Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../AuthWrapper';
import PageTransition from '../ui/PageTransition';
import BottomSheet from '../ui/BottomSheet';
import { format, isAfter } from 'date-fns';
import { notifyPartner } from '../../services/notificationService';

const normalizeDate = (date: any): Date => {
  if (!date) return new Date();
  if (typeof date === 'string') return new Date(date);
  if (date && typeof date.toDate === 'function') return date.toDate();
  return new Date(date);
};

interface Chore {
  id: string;
  title: string;
  dueDate: Timestamp;
  assignedTo: string;
  assignedToName: string;
  completed: boolean;
  completedAt?: Timestamp;
  completedBy?: string;
  createdAt: Timestamp;
}

// Pure fairness algorithm — no AI needed
function calcFairnessScore(
  chores: Chore[],
  userId: string,
  partnerId: string
): { score: number; userCount: number; partnerCount: number; suggestUserId: string | null } {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent = chores.filter(c => c.completed && normalizeDate(c.completedAt) >= cutoff);
  const userCount   = recent.filter(c => c.completedBy === userId).length;
  const partnerCount = recent.filter(c => c.completedBy === partnerId).length;
  const total = userCount + partnerCount;
  if (total === 0) return { score: 100, userCount: 0, partnerCount: 0, suggestUserId: null };
  const userShare = userCount / total;
  // 100 = perfect 50/50; deduct 2 points for every 1% off balance
  const score = Math.round(Math.max(0, 100 - Math.abs(userShare - 0.5) * 200));
  const suggestUserId = userCount <= partnerCount ? userId : partnerId;
  return { score, userCount, partnerCount, suggestUserId };
}

export default function ChoresTab({ onBack }: { onBack: () => void }) {
  const { user, householdId, userData } = useAuth();
  const [chores, Chores] = useState<Chore[]>([]);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState('Partner');
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDueDate, setNewDueDate] = useState(format(new Date(), "yyyy-MM-dd"));

  useEffect(() => {
    if (!householdId || !user) return;

    // Fetch partner ID from household
    getDoc(doc(db, 'households', householdId)).then(snap => {
      const memberIds: string[] = snap.data()?.memberIds || [];
      const pid = memberIds.find(id => id !== user.uid) || null;
      setPartnerId(pid);
      if (pid) {
        getDoc(doc(db, 'users', pid)).then(uSnap => {
          setPartnerName(uSnap.data()?.displayName?.split(' ')[0] || 'Partner');
        });
      }
    });

    const q = query(
      collection(db, 'households', householdId, 'chores'),
      orderBy('dueDate', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Chore));
      Chores(fetched);
    });

    return () => unsubscribe();
  }, [householdId, user?.uid]);

  const handleAddChore = async () => {
    if (!newTitle.trim() || !householdId || !user) {
      console.error("Missing required data for adding chore:", { newTitle, householdId, user: !!user });
      return;
    }

    try {
      // Auto-assign to whoever is behind on fairness
      const assignTo = fairness?.suggestUserId || user.uid;
      const assignName = assignTo === user.uid
        ? (user.displayName || 'You')
        : partnerName;

      await addDoc(collection(db, 'households', householdId, 'chores'), {
        title: newTitle,
        dueDate: Timestamp.fromDate(new Date(newDueDate)),
        assignedTo: assignTo,
        assignedToName: assignName,
        completed: false,
        createdAt: serverTimestamp()
      });

      setIsAddSheetOpen(false);
      setNewTitle('');
    } catch (error) {
      console.error("Error adding chore:", error);
      alert("Failed to add chore. Please try again.");
    }
  };

  const toggleChore = async (chore: Chore) => {
    if (!householdId || !user) return;

    try {
      const isCompleting = !chore.completed;
      await updateDoc(doc(db, 'households', householdId, 'chores', chore.id), {
        completed: isCompleting,
        completedAt: isCompleting ? serverTimestamp() : null,
        completedBy: isCompleting ? user.uid : null
      });

      if (isCompleting) {
        await notifyPartner(
          householdId,
          user.uid,
          "Chores",
          `${user.displayName || 'Partner'} completed ${chore.title} ✓`,
          "chores"
        );
      }
    } catch (error) {
      console.error("Error toggling chore:", error);
    }
  };

  const deleteChore = async (id: string) => {
    if (!householdId) return;
    await deleteDoc(doc(db, 'households', householdId, 'chores', id));
  };

  const activeChores = chores.filter(c => !c.completed);
  const completedChores = chores.filter(c => c.completed);

  const fairness = useMemo(() => {
    if (!user || !partnerId) return null;
    return calcFairnessScore(chores, user.uid, partnerId);
  }, [chores, user?.uid, partnerId]);

  const suggestAssignName = fairness?.suggestUserId === user?.uid
    ? (userData?.displayName?.split(' ')[0] || 'You')
    : partnerName;

  return (
    <PageTransition>
      <div className="flex flex-col h-full bg-[#fcf9f4]">
        <div className="px-6 pt-16 pb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 -ml-2 text-[#1A1A1A]">
              <ChevronLeft size={24} />
            </button>
            <h1 className="font-serif text-[32px] text-[#1A1A1A]">Chores</h1>
          </div>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsAddSheetOpen(true)}
            className="w-10 h-10 rounded-full bg-[#1A1A1A] text-white flex items-center justify-center"
          >
            <Plus size={20} />
          </motion.button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-20 no-scrollbar">
          {/* Fairness Score Card */}
          {fairness && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 bg-[#EDE8DF] border border-[#D4CEC4] rounded-[20px] p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <p className="font-outfit text-[11px] uppercase tracking-widest text-[#6B6560]">30-day Fairness</p>
                <span
                  className="font-serif text-[22px]"
                  style={{ color: fairness.score >= 80 ? '#7FAF7B' : fairness.score >= 50 ? '#B8955A' : '#C47B6A' }}
                >
                  {fairness.score}
                </span>
              </div>
              {/* Bar */}
              <div className="h-2 bg-[#D4CEC4] rounded-full overflow-hidden mb-3">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${fairness.score}%` }}
                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full rounded-full"
                  style={{ background: fairness.score >= 80 ? '#7FAF7B' : fairness.score >= 50 ? '#B8955A' : '#C47B6A' }}
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="font-outfit text-[12px] text-[#6B6560]">
                  You: {fairness.userCount} · {partnerName}: {fairness.partnerCount}
                </p>
                {fairness.score < 90 && (
                  <p className="font-outfit text-[11px] text-[#B8955A]">
                    Next up: {suggestAssignName}
                  </p>
                )}
              </div>
            </motion.div>
          )}

          {activeChores.length > 0 && (
            <div className="mb-8">
              <h3 className="font-outfit text-xs font-bold text-[#6B6560] uppercase tracking-widest mb-4">To Do</h3>
              <div className="space-y-3">
                {activeChores.map(chore => (
                  <ChoreCard 
                    key={chore.id} 
                    chore={chore} 
                    onToggle={() => toggleChore(chore)} 
                    onDelete={() => deleteChore(chore.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {completedChores.length > 0 && (
            <div>
              <h3 className="font-outfit text-xs font-bold text-[#6B6560] uppercase tracking-widest mb-4">Completed</h3>
              <div className="space-y-3 opacity-60">
                {completedChores.map(chore => (
                  <ChoreCard 
                    key={chore.id} 
                    chore={chore} 
                    onToggle={() => toggleChore(chore)} 
                    onDelete={() => deleteChore(chore.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <BottomSheet 
          isOpen={isAddSheetOpen} 
          onClose={() => setIsAddSheetOpen(false)}
          footer={
            <button
              onClick={handleAddChore}
              className="w-full h-14 bg-[#1A1A1A] text-white rounded-full font-outfit font-medium"
            >
              Add Chore
            </button>
          }
        >
          <div className="space-y-6 py-4">
            <input
              autoFocus
              placeholder="What needs to be done?"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full bg-transparent border-none focus:ring-0 font-serif text-[22px] text-[#1A1A1A] placeholder-[#6B6560]/40"
            />
            <div>
              <label className="font-outfit text-xs font-bold text-[#6B6560] uppercase tracking-widest mb-2 block">Due Date</label>
              <input 
                type="date" 
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="w-full bg-[#EDE8DF] border border-[#D4CEC4] rounded-xl p-3 font-outfit text-[#1A1A1A]"
              />
            </div>
          </div>
        </BottomSheet>
      </div>
    </PageTransition>
  );
}

function ChoreCard({ chore, onToggle, onDelete }: { chore: Chore, onToggle: () => void, onDelete: () => void }) {
  const isOverdue = !chore.completed && isAfter(new Date(), normalizeDate(chore.dueDate));

  return (
    <motion.div 
      layout
      className="bg-[#EDE8DF] border border-[#D4CEC4] rounded-[20px] p-4 flex items-center gap-4"
    >
      <button 
        onClick={onToggle}
        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
          chore.completed ? 'bg-[#7FAF7B] border-[#7FAF7B]' : 'border-[#D4CEC4]'
        }`}
      >
        {chore.completed && <Check size={14} className="text-white" strokeWidth={3} />}
      </button>
      
      <div className="flex-1 min-w-0">
        <h4 className={`font-serif text-[18px] text-[#1A1A1A] ${chore.completed ? 'line-through opacity-50' : ''}`}>
          {chore.title}
        </h4>
        <div className="flex items-center gap-3 mt-1">
          <div className={`flex items-center gap-1 font-outfit text-[12px] ${isOverdue ? 'text-[#C97B6A]' : 'text-[#6B6560]'}`}>
            <Clock size={12} />
            <span>{format(normalizeDate(chore.dueDate), 'MMM d')}</span>
          </div>
          <div className="flex items-center gap-1 font-outfit text-[12px] text-[#6B6560]">
            <User size={12} />
            <span>{chore.assignedToName}</span>
          </div>
        </div>
      </div>

      <button onClick={onDelete} className="p-2 text-[#D4CEC4] hover:text-[#C97B6A]">
        <Trash2 size={18} />
      </button>
    </motion.div>
  );
}
