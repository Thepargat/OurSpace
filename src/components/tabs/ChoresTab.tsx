import { useState, useEffect } from 'react';
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

export default function ChoresTab({ onBack }: { onBack: () => void }) {
  const { user, householdId, userData } = useAuth();
  const [chores, Chores] = useState<Chore[]>([]);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDueDate, setNewDueDate] = useState(format(new Date(), "yyyy-MM-dd"));

  useEffect(() => {
    if (!householdId) return;

    const q = query(
      collection(db, 'households', householdId, 'chores'),
      orderBy('dueDate', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Chore));
      Chores(fetched);
    });

    return () => unsubscribe();
  }, [householdId]);

  const handleAddChore = async () => {
    if (!newTitle.trim() || !householdId || !user) {
      console.error("Missing required data for adding chore:", { newTitle, householdId, user: !!user });
      return;
    }

    try {
      await addDoc(collection(db, 'households', householdId, 'chores'), {
        title: newTitle,
        dueDate: Timestamp.fromDate(new Date(newDueDate)),
        assignedTo: user.uid, // For now assign to self or partner
        assignedToName: user.displayName || 'Partner',
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
