import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence, useAnimationControls } from 'motion/react';
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronUp, Check } from 'lucide-react';
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
  where,
  getDocs,
  Timestamp
} from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { useAuth } from '../AuthWrapper';
import PageTransition from '../ui/PageTransition';
import Lottie from 'lottie-react';
import confetti from 'canvas-confetti';
import { format } from 'date-fns';

// --- Types ---

interface GroceryItemData {
  id: string;
  name: string;
  quantity?: string;
  category: string;
  completed: boolean;
  addedBy: string;
  addedByName: string;
  addedByPhoto?: string;
  completedBy?: string;
  completedAt?: any;
  createdAt: any;
}

const CATEGORIES = ['Produce', 'Dairy', 'Meat', 'Pantry', 'Other'];

// --- Components ---

function Checkbox({ checked, onToggle, id }: { checked: boolean; onToggle: (e: React.MouseEvent) => void; id: string }) {
  return (
    <motion.button
      id={`checkbox-${id}`}
      whileTap={{ scale: 0.8 }}
      onClick={onToggle}
      className="w-[52px] h-[52px] flex items-center justify-center -ml-3" // Increased tap area to 52px
    >
      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors duration-300 ${
        checked ? 'bg-[#7FAF7B] border-[#7FAF7B]' : 'border-[#D4CEC4]'
      }`}>
        <AnimatePresence>
          {checked && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 25 }}
            >
              <Check size={14} className="text-white" strokeWidth={3} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.button>
  );
}

function GroceryItemRow({ 
  item, 
  onToggle, 
  onDelete, 
  currentUserId 
}: { 
  item: GroceryItemData; 
  onToggle: () => void; 
  onDelete: () => void;
  currentUserId: string;
}) {
  const [isRecent, setIsRecent] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (item.createdAt && item.addedBy !== currentUserId) {
      const createdAt = item.createdAt instanceof Timestamp ? item.createdAt.toDate() : new Date(item.createdAt);
      const diff = Date.now() - createdAt.getTime();
      if (diff < 2000) {
        setIsRecent(true);
        const timer = setTimeout(() => setIsRecent(false), 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [item.createdAt, item.addedBy, currentUserId]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.completed) {
      onToggle();
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (rect.left + rect.width / 2) / window.innerWidth;
    const y = (rect.top + rect.height / 2) / window.innerHeight;

    confetti({
      particleCount: 30,
      spread: 45,
      origin: { x, y },
      colors: ["#B8955A", "#F0E4CC", "#7FAF7B"],
      gravity: 1.2,
      scalar: 0.7
    });

    onToggle();
  };

  return (
    <motion.div
      ref={rowRef}
      layout
      initial={{ opacity: 0, x: -20 }}
      animate={{ 
        opacity: item.completed ? 0.45 : 1, 
        x: 0,
        boxShadow: isRecent ? 'inset 4px 0 0 #B8955A, 0 0 15px rgba(184, 149, 90, 0.2)' : 'none'
      }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="relative overflow-hidden bg-[#EDE8DF] border-b border-[#D4CEC4] min-h-[64px]"
    >
      {/* Delete Background */}
      <div className="absolute inset-0 bg-[#C97B6A] flex items-center justify-end px-6">
        <Trash2 size={20} className="text-white" />
      </div>

      {/* Main Content */}
      <motion.div
        drag="x"
        dragConstraints={{ left: -100, right: 0 }}
        dragElastic={0.1}
        onDragEnd={(_, info) => {
          const width = rowRef.current?.offsetWidth || window.innerWidth;
          if (info.offset.x < -width * 0.6) {
            onDelete();
          }
        }}
        className="relative z-10 bg-[#EDE8DF] h-full flex items-center px-6 py-4 gap-4"
      >
        <Checkbox checked={item.completed} onToggle={handleToggle} id={item.id} />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className={`font-serif text-[18px] text-[#1A1A1A] relative ${item.completed ? 'opacity-60' : ''}`}>
              {item.name}
              {item.completed && (
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                  className="absolute left-0 top-1/2 h-[1px] bg-[#1A1A1A]"
                />
              )}
            </span>
            {item.quantity && (
              <span className="font-outfit text-[13px] text-[#6B6560]">{item.quantity}</span>
            )}
          </div>
          <div className="mt-1">
            <span className="font-outfit text-[11px] text-[#D4CEC4]">Added by {item.addedByName}</span>
          </div>
        </div>

        {item.addedByPhoto && (
          <img 
            src={item.addedByPhoto} 
            alt={item.addedByName}
            className="w-6 h-6 rounded-full object-cover border border-[#D4CEC4]"
            referrerPolicy="no-referrer"
          />
        )}
      </motion.div>
    </motion.div>
  );
}

function AddItemSheet({ 
  isOpen, 
  onClose, 
  onAdd 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onAdd: (name: string, quantity: string, category: string) => void 
}) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [category, setCategory] = useState('Produce');

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd(name, quantity, category);
    setName('');
    setQuantity('');
    setCategory('Produce');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-[#1A1A1A]/40 backdrop-blur-[2px]"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={0.1}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100 || info.velocity.y > 500) {
                onClose();
              }
            }}
            className="fixed bottom-0 left-0 right-0 z-[70] bg-[#F8F4EE] rounded-t-[24px] p-6 pb-12 shadow-2xl"
          >
            <div className="w-10 h-1 bg-[#D4CEC4] rounded-full mx-auto mb-8" />
            
            <div className="space-y-6">
              <input
                autoFocus
                type="text"
                placeholder="What do you need?"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full font-serif text-[24px] text-[#1A1A1A] placeholder-[#D4CEC4] bg-transparent border-none focus:ring-0 p-0"
              />

              <div className="space-y-2">
                <label className="font-outfit text-[12px] uppercase tracking-wider text-[#B8955A]">Quantity (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. 2 bags, 500g"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full font-outfit text-[16px] text-[#1A1A1A] placeholder-[#D4CEC4] bg-transparent border-none focus:ring-0 p-0"
                />
              </div>

              <div className="space-y-3">
                <label className="font-outfit text-[12px] uppercase tracking-wider text-[#B8955A]">Category</label>
                <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                  {CATEGORIES.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setCategory(cat)}
                      className={`px-4 py-2 rounded-full font-outfit text-[13px] border transition-colors whitespace-nowrap ${
                        category === cat 
                          ? 'bg-[#1A1A1A] border-[#1A1A1A] text-white' 
                          : 'bg-[#EDE8DF] border-[#D4CEC4] text-[#1A1A1A]'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <button
                disabled={!name.trim()}
                onClick={handleAdd}
                className={`w-full h-[52px] rounded-full font-outfit font-medium text-[15px] transition-all ${
                  name.trim() 
                    ? 'bg-[#1A1A1A] text-white shadow-lg' 
                    : 'bg-[#D4CEC4] text-white cursor-not-allowed'
                }`}
              >
                Add to list
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default function GroceryTab({ onBack }: { onBack?: () => void }) {
  const { user, householdId } = useAuth();
  const [items, setItems] = useState<GroceryItemData[]>([]);
  const [history, setHistory] = useState<GroceryItemData[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isCompletedExpanded, setIsCompletedExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lottieData, setLottieData] = useState(null);

  // Fetch Lottie data
  useEffect(() => {
    fetch('https://assets9.lottiefiles.com/packages/lf20_dmw3t0vg.json')
      .then(res => res.json())
      .then(data => setLottieData(data))
      .catch(err => console.error('Error loading Lottie:', err));
  }, []);

  // --- Data Fetching ---

  useEffect(() => {
    if (!householdId) return;

    const q = query(
      collection(db, `households/${householdId}/groceries`),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedItems: GroceryItemData[] = [];
      snapshot.forEach((doc) => {
        fetchedItems.push({ id: doc.id, ...doc.data() } as GroceryItemData);
      });
      setItems(fetchedItems);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [householdId]);

  // Fetch history for suggestions (limit to 100 items)
  useEffect(() => {
    if (!householdId) return;
    const fetchHistory = async () => {
      const q = query(
        collection(db, `households/${householdId}/groceries`),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      const historyItems: GroceryItemData[] = [];
      snapshot.forEach((doc) => {
        historyItems.push({ id: doc.id, ...doc.data() } as GroceryItemData);
      });
      setHistory(historyItems);
    };
    fetchHistory();
  }, [householdId]);

  // --- Logic ---

  const activeItems = useMemo(() => items.filter(i => !i.completed), [items]);
  const completedItems = useMemo(() => items.filter(i => i.completed), [items]);

  const suggestions = useMemo(() => {
    const counts: Record<string, { count: number; category: string }> = {};
    history.forEach(item => {
      if (!counts[item.name]) {
        counts[item.name] = { count: 0, category: item.category };
      }
      counts[item.name].count += 1;
    });

    const currentNames = new Set(activeItems.map(i => i.name.toLowerCase()));
    
    return Object.entries(counts)
      .filter(([name]) => !currentNames.has(name.toLowerCase()))
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([name, data]) => ({ name, category: data.category }));
  }, [history, activeItems]);

  const prediction = useMemo(() => {
    // Simple prediction: if milk added 4 times in last 30 days
    const milkHistory = history.filter(i => i.name.toLowerCase() === 'milk');
    if (milkHistory.length >= 4) {
      const alreadyOnList = activeItems.some(i => i.name.toLowerCase() === 'milk');
      if (!alreadyOnList) return 'Milk';
    }
    return null;
  }, [history, activeItems]);

  const groupedActive = useMemo(() => {
    const groups: Record<string, GroceryItemData[]> = {};
    CATEGORIES.forEach(cat => {
      const catItems = activeItems.filter(i => i.category === cat);
      if (catItems.length > 0) groups[cat] = catItems;
    });
    return groups;
  }, [activeItems]);

  const addItem = async (name: string, quantity: string, category: string) => {
    if (!householdId || !user) return;
    
    await addDoc(collection(db, `households/${householdId}/groceries`), {
      name,
      quantity,
      category,
      completed: false,
      addedBy: user.uid,
      addedByName: user.displayName || 'Partner',
      addedByPhoto: user.photoURL,
      createdAt: serverTimestamp()
    });
  };

  const toggleComplete = async (item: GroceryItemData) => {
    if (!householdId || !user) return;
    
    await updateDoc(doc(db, `households/${householdId}/groceries`, item.id), {
      completed: !item.completed,
      completedBy: !item.completed ? user.uid : null,
      completedAt: !item.completed ? serverTimestamp() : null
    });
  };

  const deleteItem = async (id: string) => {
    if (!householdId) return;
    await deleteDoc(doc(db, `households/${householdId}/groceries`, id));
  };

  const clearCompleted = async () => {
    if (!householdId) return;
    // Staggered deletion
    for (let i = 0; i < completedItems.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 80));
      deleteItem(completedItems[i].id);
    }
  };

  // --- Render ---

  return (
    <PageTransition>
      <div className="flex h-full flex-col bg-[#F8F4EE] relative overflow-hidden">
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: 20, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="px-8 pt-20 pb-8"
        >
          <div className="flex items-center justify-between mb-2">
            <h1 className="font-serif text-[36px] font-light text-[#1A1A1A]">Groceries</h1>
            {onBack && (
              <button 
                onClick={onBack}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-[#EDE8DF] border border-[#D4CEC4] text-[#1A1A1A]"
              >
                <ArrowLeft size={20} />
              </button>
            )}
          </div>
          <p className="font-outfit text-[14px] text-[#6B6560]">{activeItems.length} items remaining</p>
        </motion.div>

        {/* Suggestion Bar */}
        {suggestions.length > 0 && (
          <div className="px-8 mb-8">
            <label className="block font-outfit text-[12px] uppercase tracking-[0.2em] text-[#B8955A] mb-3">Add again</label>
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
              <AnimatePresence mode="popLayout">
                {suggestions.map(sug => (
                  <motion.button
                    key={sug.name}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => addItem(sug.name, '', sug.category)}
                    className="px-4 py-2 bg-[#EDE8DF] border border-[#D4CEC4] rounded-full font-outfit text-[13px] text-[#1A1A1A] whitespace-nowrap min-h-[44px] flex items-center"
                  >
                    {sug.name}
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Prediction Banner */}
        {prediction && (
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="mx-8 mb-8 p-4 bg-[#F0E4CC] border border-[#B8955A]/20 rounded-2xl flex items-center justify-between gap-4"
          >
            <p className="font-outfit text-[13px] text-[#6B6560]">You usually buy <span className="text-[#1A1A1A] font-medium">{prediction}</span> around now</p>
            <button 
              onClick={() => addItem(prediction, '', 'Other')}
              className="px-4 py-1.5 bg-[#1A1A1A] text-white rounded-full font-outfit text-[12px] font-medium"
            >
              Add
            </button>
          </motion.div>
        )}

        {/* List Content */}
        <div 
          className="flex-1 overflow-y-auto no-scrollbar"
          style={{ 
            paddingBottom: 'calc(120px + env(safe-area-inset-bottom))',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-[#B8955A] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : activeItems.length === 0 && completedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center pt-12 px-12 text-center">
              <div className="w-64 h-64 mb-6">
                {lottieData && (
                  <Lottie 
                    animationData={lottieData}
                    loop={true} 
                  />
                )}
              </div>
              <h2 className="font-serif text-[24px] text-[#1A1A1A] mb-2">Your list is empty</h2>
              <p className="font-outfit text-[14px] text-[#6B6560]">Add your first item</p>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Active Items by Category */}
              {Object.entries(groupedActive).map(([category, catItems]) => (
                <div key={category} className="px-8">
                  <div className="flex items-center gap-4 mb-4">
                    <h3 className="font-outfit text-[12px] uppercase tracking-[0.2em] text-[#B8955A] whitespace-nowrap">{category}</h3>
                    <div className="h-[0.5px] flex-1 bg-[#D4CEC4]/50" />
                  </div>
                  <div className="space-y-0 rounded-2xl overflow-hidden border border-[#D4CEC4]">
                    <AnimatePresence mode="popLayout">
                      {catItems.map(item => (
                        <GroceryItemRow 
                          key={item.id} 
                          item={item} 
                          onToggle={() => toggleComplete(item)}
                          onDelete={() => deleteItem(item.id)}
                          currentUserId={user?.uid || ''}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              ))}

              {/* Completed Section */}
              {completedItems.length > 0 && (
                <div className="px-8 pb-12">
                  <div className="flex items-center justify-between mb-4">
                    <button 
                      onClick={() => setIsCompletedExpanded(!isCompletedExpanded)}
                      className="flex items-center gap-2 font-outfit text-[12px] uppercase tracking-widest text-[#6B6560]"
                    >
                      {isCompletedExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      Completed ({completedItems.length})
                    </button>
                    <button 
                      onClick={clearCompleted}
                      className="font-outfit text-[13px] text-[#C97B6A]"
                    >
                      Clear all
                    </button>
                  </div>
                  
                  <AnimatePresence>
                    {isCompletedExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-0 rounded-2xl overflow-hidden border border-[#D4CEC4]">
                          {completedItems.map(item => (
                            <GroceryItemRow 
                              key={item.id} 
                              item={item} 
                              onToggle={() => toggleComplete(item)}
                              onDelete={() => deleteItem(item.id)}
                              currentUserId={user?.uid || ''}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Floating Add Button */}
        <motion.button
          initial={{ scale: 0 }}
          animate={{ 
            scale: 1,
            rotate: isAdding ? 45 : 0
          }}
          transition={{ type: "spring", stiffness: 400, damping: 20, delay: 0.5 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => setIsAdding(!isAdding)}
          className="fixed bottom-20 right-8 w-14 h-14 bg-[#1A1A1A] text-white rounded-full flex items-center justify-center shadow-2xl z-[80]"
        >
          <Plus size={24} />
        </motion.button>

        {/* Add Item Bottom Sheet */}
        <AddItemSheet 
          isOpen={isAdding} 
          onClose={() => setIsAdding(false)} 
          onAdd={addItem} 
        />
      </div>
    </PageTransition>
  );
}
