import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Check, MapPin, Tag, User, Loader2, MoreVertical } from 'lucide-react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../AuthWrapper';
import BottomSheet from '../ui/BottomSheet';
import confetti from 'canvas-confetti';
import { notifyPartner } from '../../services/notificationService';

interface BucketItem {
  id: string;
  title: string;
  location?: string;
  category: 'travel' | 'experience' | 'food' | 'home' | 'other';
  notes?: string;
  addedBy: string;
  adderName: string;
  addedAt: Timestamp;
  completed: boolean;
  completedAt?: Timestamp;
  completedBy?: string;
}

const CATEGORIES = [
  { id: 'travel' as const, label: 'Travel', icon: '✈️' },
  { id: 'experience' as const, label: 'Experience', icon: '✨' },
  { id: 'food' as const, label: 'Food', icon: '🍝' },
  { id: 'home' as const, label: 'Home', icon: '🏠' },
  { id: 'other' as const, label: 'Other', icon: '🌟' },
];

export default function BucketList() {
  const { user, householdId, userData } = useAuth();
  const [items, setItems] = useState<BucketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddSheetOpen, setIsAddSheetOpen] = useState(false);
  const [confirmCompleteId, setConfirmCompleteId] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<BucketItem['category']>('travel');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!householdId) return;

    const q = query(
      collection(db, 'households', householdId, 'bucketList'),
      orderBy('addedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newItems = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as BucketItem[];
      setItems(newItems);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [householdId]);

  const handleAddItem = async () => {
    if (!title || !householdId || !user) {
      console.error("Missing required data for adding bucket item:", { title, householdId, user: !!user });
      return;
    }

    try {
      await addDoc(collection(db, 'households', householdId, 'bucketList'), {
        title,
        location,
        category,
        notes,
        addedBy: user.uid,
        adderName: userData?.displayName || user.displayName || 'Partner',
        addedAt: serverTimestamp(),
        completed: false,
        completedAt: null,
        completedBy: null
      });

      // Trigger Notification
      await notifyPartner(
        householdId,
        user.uid,
        "Bucket List",
        `${userData?.displayName || user.displayName || 'Partner'} added ${title} to your bucket list`,
        "bucket"
      );

      setIsAddSheetOpen(false);
      setTitle('');
      setLocation('');
      setCategory('travel');
      setNotes('');
    } catch (error) {
      console.error("Error adding bucket item:", error);
      alert("Failed to add item. Please try again.");
    }
  };

  const completeItem = async (itemId: string) => {
    if (!householdId || !user) return;

    try {
      const itemRef = doc(db, 'households', householdId, 'bucketList', itemId);
      const item = items.find(i => i.id === itemId);
      await updateDoc(itemRef, {
        completed: true,
        completedAt: serverTimestamp(),
        completedBy: user.uid
      });

      // Trigger Notification
      if (item) {
        await notifyPartner(
          householdId,
          user.uid,
          "Bucket List",
          `${userData?.displayName || user.displayName || 'Partner'} ticked off ${item.title} 🎉`,
          "bucket"
        );
      }

      confetti({
        particleCount: 60,
        spread: 80,
        colors: ["#B8955A", "#F0E4CC", "#7FAF7B"],
        gravity: 0.9
      });

      setConfirmCompleteId(null);
    } catch (error) {
      console.error("Error completing item:", error);
      alert("Failed to complete item. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-[#B8955A] animate-spin mb-4" />
        <p className="font-outfit text-[#6B6560]">Loading your list...</p>
      </div>
    );
  }

  const todoItems = items.filter(i => !i.completed);
  const doneItems = items.filter(i => i.completed);

  return (
    <div className="relative min-h-full">
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <h2 className="font-serif text-[22px] text-[#1A1A1A]">Your list is empty</h2>
            <p className="font-outfit text-[14px] text-[#6B6560]">Add something you both want to do</p>
          </motion.div>
        </div>
      ) : (
        <div className="space-y-8 pb-32">
          {/* To Do Section */}
          {todoItems.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-outfit text-xs font-bold text-[#6B6560] uppercase tracking-widest px-1">To Do</h3>
              <div className="space-y-3">
                {todoItems.map(item => (
                  <BucketCard 
                    key={item.id} 
                    item={item} 
                    onLongPress={() => setConfirmCompleteId(item.id)} 
                  />
                ))}
              </div>
            </div>
          )}

          {/* Done Section */}
          {doneItems.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-outfit text-xs font-bold text-[#6B6560] uppercase tracking-widest px-1">Done</h3>
              <div className="space-y-3">
                {doneItems.map(item => (
                  <BucketCard key={item.id} item={item} isDone />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* FAB */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => setIsAddSheetOpen(true)}
        className="fixed bottom-[100px] right-6 w-14 h-14 bg-[#1A1A1A] text-white rounded-full flex items-center justify-center shadow-lg z-50"
      >
        <Plus size={28} />
      </motion.button>

      {/* Add Sheet */}
      <BottomSheet 
        isOpen={isAddSheetOpen} 
        onClose={() => setIsAddSheetOpen(false)}
        footer={
          <button
            onClick={handleAddItem}
            disabled={!title}
            className="w-full h-14 bg-[#1A1A1A] text-white rounded-full font-outfit font-medium text-lg shadow-lg disabled:opacity-50"
          >
            Add to List ✦
          </button>
        }
      >
        <div className="space-y-8 py-4">
          <div className="space-y-2">
            <input
              autoFocus
              placeholder="What do you want to do?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-transparent border-none focus:ring-0 font-serif text-[22px] text-[#1A1A1A] placeholder-[#6B6560]/40 p-0"
            />
            <div className="flex items-center gap-2 text-[#6B6560]">
              <MapPin size={16} />
              <input
                placeholder="Where?"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="flex-1 bg-transparent border-none focus:ring-0 font-outfit text-[16px] p-0 placeholder-[#6B6560]/40"
              />
            </div>
          </div>

          <div className="space-y-3">
            <p className="font-outfit text-xs font-bold text-[#6B6560] uppercase tracking-widest">Category</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setCategory(cat.id)}
                  className={`px-4 py-2 rounded-full font-outfit text-sm transition-all border ${
                    category === cat.id 
                      ? 'bg-[#B8955A] text-white border-[#B8955A]' 
                      : 'bg-white text-[#6B6560] border-[#D4CEC4]'
                  }`}
                >
                  {cat.icon} {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="font-outfit text-xs font-bold text-[#6B6560] uppercase tracking-widest">Notes (Optional)</p>
            <textarea
              placeholder="Any extra details..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-white/50 border border-[#D4CEC4] rounded-2xl p-4 font-outfit text-sm focus:ring-1 focus:ring-[#B8955A] focus:border-[#B8955A] outline-none min-h-[100px] resize-none"
            />
          </div>
        </div>
      </BottomSheet>

      {/* Confirmation Dialog */}
      <AnimatePresence>
        {confirmCompleteId && (
          <div className="fixed inset-0 z-[10001] flex items-center justify-center px-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-[#1A1A1A]/60 backdrop-blur-sm"
              onClick={() => setConfirmCompleteId(null)}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-xs bg-[#F8F4EE] rounded-[32px] p-8 text-center shadow-2xl"
            >
              <div className="w-16 h-16 bg-[#B8955A]/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Check className="text-[#B8955A]" size={32} />
              </div>
              <h3 className="font-serif text-2xl text-[#1A1A1A] mb-2">Mark as Done?</h3>
              <p className="font-outfit text-[#6B6560] mb-8">Did you complete this adventure together?</p>
              <div className="space-y-3">
                <button
                  onClick={() => completeItem(confirmCompleteId)}
                  className="w-full h-14 bg-[#1A1A1A] text-white rounded-full font-outfit font-medium shadow-lg"
                >
                  Yes, we did it!
                </button>
                <button
                  onClick={() => setConfirmCompleteId(null)}
                  className="w-full h-14 bg-transparent text-[#6B6560] rounded-full font-outfit font-medium"
                >
                  Not yet
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BucketCard({ item, onLongPress, isDone }: { item: BucketItem, onLongPress?: () => void, isDone?: boolean }) {
  const timerRef = useRef<any>(null);

  const handleTouchStart = () => {
    if (isDone) return;
    timerRef.current = setTimeout(() => {
      onLongPress?.();
    }, 600);
  };

  const handleTouchEnd = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const categoryInfo = CATEGORIES.find(c => c.id === item.category);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: isDone ? 0.6 : 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleTouchStart}
      onMouseUp={handleTouchEnd}
      onMouseLeave={handleTouchEnd}
      className={`relative p-5 rounded-[24px] border border-[#D4CEC4] bg-[#EDE8DF] shadow-sm transition-all active:scale-[0.98] ${isDone ? 'grayscale-[0.5]' : ''}`}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg">{categoryInfo?.icon}</span>
            <h4 className="font-serif text-[18px] text-[#1A1A1A] leading-tight">{item.title}</h4>
          </div>
          
          {item.location && (
            <div className="flex items-center gap-1.5 text-[#6B6560]">
              <MapPin size={13} />
              <span className="font-outfit text-[13px]">{item.location}</span>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <span className="px-2.5 py-0.5 rounded-full bg-[#D4CEC4]/40 text-[#6B6560] font-outfit text-[10px] font-bold uppercase tracking-wider">
              {item.category}
            </span>
            <div className="flex items-center gap-1.5 text-[#6B6560]/60">
              <User size={12} />
              <span className="font-outfit text-[11px]">{item.adderName}</span>
            </div>
          </div>
        </div>

        {isDone && (
          <div className="w-8 h-8 rounded-full bg-[#B8955A] flex items-center justify-center text-white shadow-sm">
            <Check size={16} strokeWidth={3} />
          </div>
        )}
      </div>
    </motion.div>
  );
}
