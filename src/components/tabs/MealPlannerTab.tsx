import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { 
  doc, 
  onSnapshot, 
  setDoc, 
  serverTimestamp, 
  Timestamp,
  addDoc,
  collection
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../AuthWrapper';
import { 
  startOfWeek, 
  addDays, 
  format, 
  isSameDay, 
  addWeeks, 
  subWeeks
} from 'date-fns';
import BottomSheet from '../ui/BottomSheet';
import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Gemini helpers
const getGeminiModel = () => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return null;
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: "gemini-flash-latest" });
};

interface MealSlot {
  breakfast: string;
  lunch: string;
  dinner: string;
}

interface MealPlan {
  weekStarting: Timestamp;
  monday?: MealSlot;
  tuesday?: MealSlot;
  wednesday?: MealSlot;
  thursday?: MealSlot;
  friday?: MealSlot;
  saturday?: MealSlot;
  sunday?: MealSlot;
  updatedBy?: string;
  updatedAt?: Timestamp;
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type DayName = typeof DAYS[number];
type MealType = 'breakfast' | 'lunch' | 'dinner';

export default function MealPlannerTab({ onBack }: { onBack: () => void }) {
  const { user, householdId } = useAuth();
  const [currentMonday, setCurrentMonday] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditSheetOpen, setIsEditSheetOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState<{ day: DayName, type: MealType } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isGeneratingGroceries, setIsGeneratingGroceries] = useState(false);
  const [lastChangedSlot, setLastChangedSlot] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const weekId = format(currentMonday, 'yyyy-MM-dd');

  // 1. Listen to Meal Plan
  useEffect(() => {
    if (!householdId) return;

    const planRef = doc(db, 'households', householdId, 'meals', weekId);
    const unsubscribe = onSnapshot(planRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as MealPlan;
        setMealPlan(data);
      } else {
        setMealPlan(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [householdId, weekId]);

  // 2. Track changes for highlight
  useEffect(() => {
    if (!mealPlan) return;
    // This is a simple way to detect a change from the server
    // In a real app we might compare previous state
  }, [mealPlan]);

  // 3. Suggestions (last 5 unique meals)
  useEffect(() => {
    if (!mealPlan) return;
    const allMeals: string[] = [];
    DAYS.forEach(day => {
      const slots = mealPlan[day];
      if (slots) {
        if (slots.breakfast) allMeals.push(slots.breakfast);
        if (slots.lunch) allMeals.push(slots.lunch);
        if (slots.dinner) allMeals.push(slots.dinner);
      }
    });
    const unique = Array.from(new Set(allMeals)).slice(0, 5);
    setSuggestions(unique);
  }, [mealPlan]);

  const handleSaveMeal = async () => {
    if (!editingSlot || !householdId || !user) {
      console.error("Missing required data for saving meal:", { editingSlot: !!editingSlot, householdId, user: !!user });
      return;
    }

    const { day, type } = editingSlot;
    const planRef = doc(db, 'households', householdId, 'meals', weekId);
    
    const updatedDay = {
      ...(mealPlan?.[day] || { breakfast: '', lunch: '', dinner: '' }),
      [type]: editValue
    };

    try {
      await setDoc(planRef, {
        weekStarting: Timestamp.fromDate(currentMonday),
        [day]: updatedDay,
        updatedBy: user.uid,
        updatedAt: serverTimestamp()
      }, { merge: true });

      setLastChangedSlot(`${day}-${type}`);
      setTimeout(() => setLastChangedSlot(null), 1500);
      setIsEditSheetOpen(false);
    } catch (err) {
      console.error("Error saving meal:", err);
      alert("Failed to save meal. Please try again.");
    }
  };

  const handleClearMeal = async () => {
    setEditValue('');
    // We'll save with empty string
  };

  const generateGroceries = async () => {
    if (!mealPlan || !householdId || !user) return;

    const mealsList: string[] = [];
    DAYS.forEach(day => {
      const slots = mealPlan[day];
      if (slots) {
        if (slots.breakfast) mealsList.push(slots.breakfast);
        if (slots.lunch) mealsList.push(slots.lunch);
        if (slots.dinner) mealsList.push(slots.dinner);
      }
    });

    if (mealsList.length === 0) return;

    setIsGeneratingGroceries(true);
    try {
      const model = getGeminiModel();
      if (!model) throw new Error("AI model not available");

      const prompt = `These are our meals for the week: ${mealsList.join(', ')}. 
      List the ingredients needed as a simple grocery list. 
      Return ONLY a JSON array of strings. No explanation. No markdown.
      Example: ["chicken breast", "rice", "broccoli", "olive oil"]`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
      if (!responseText) throw new Error("Empty response from AI");
      
      const ingredients = JSON.parse(responseText);

      // Add to groceries
      for (const item of ingredients) {
        try {
          await addDoc(collection(db, 'households', householdId, 'groceries'), {
            name: item,
            category: 'other',
            completed: false,
            addedBy: user.uid,
            createdAt: serverTimestamp()
          });
        } catch (err) {
          console.error(`Error adding ingredient ${item}:`, err);
        }
      }

      alert(`${ingredients.length} ingredients added to your grocery list!`);
    } catch (err) {
      console.error("Error generating groceries:", err);
      alert("Failed to generate groceries. Please try again.");
    } finally {
      setIsGeneratingGroceries(false);
    }
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    setCurrentMonday(prev => direction === 'prev' ? subWeeks(prev, 1) : addWeeks(prev, 1));
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#F8F4EE]">
        <Loader2 className="h-8 w-8 animate-spin text-[#B8955A]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#F8F4EE]">
      {/* Header */}
      <div className="px-6 pt-16 pb-6">
        <div className="flex items-center gap-4 mb-8">
          <button onClick={onBack} className="p-2 -ml-2 text-[#1A1A1A]">
            <ChevronLeft size={24} />
          </button>
          <h1 className="font-serif text-[32px] text-[#1A1A1A] leading-none">Meals</h1>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <motion.button 
              whileTap={{ scale: 0.9 }}
              onClick={() => navigateWeek('prev')}
              className="w-10 h-10 rounded-full bg-[#EDE8DF] border border-[#D4CEC4] flex items-center justify-center text-[#1A1A1A]"
            >
              <ChevronLeft size={22} />
            </motion.button>
            <div className="text-center">
              <p className="font-outfit text-[14px] text-[#6B6560]">
                {format(currentMonday, 'd MMM')} – {format(addDays(currentMonday, 6), 'd MMM')}
              </p>
              {isSameDay(currentMonday, startOfWeek(new Date(), { weekStartsOn: 1 })) && (
                <p className="font-outfit text-[11px] font-bold text-[#B8955A] uppercase tracking-widest">This Week</p>
              )}
            </div>
            <motion.button 
              whileTap={{ scale: 0.9 }}
              onClick={() => navigateWeek('next')}
              className="w-10 h-10 rounded-full bg-[#EDE8DF] border border-[#D4CEC4] flex items-center justify-center text-[#1A1A1A]"
            >
              <ChevronRight size={22} />
            </motion.button>
          </div>
        </div>
      </div>

      {/* Day Cards */}
      <div className="flex-1 overflow-y-auto px-6 pb-40 no-scrollbar">
        {DAYS.map((day, index) => {
          const date = addDays(currentMonday, index);
          const isToday = isSameDay(date, new Date());
          const slots = mealPlan?.[day] || { breakfast: '', lunch: '', dinner: '' };

          return (
            <motion.div
              key={day}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className={`p-5 rounded-[20px] bg-[#EDE8DF] border border-[#D4CEC4] mb-3 relative overflow-hidden ${
                isToday ? 'border-l-[4px] border-l-[#B8955A]' : ''
              }`}
            >
              <h3 className="font-serif text-[20px] text-[#1A1A1A] mb-4 capitalize">{day}</h3>
              
              <div className="space-y-4">
                <MealRow 
                  label="BREAKFAST" 
                  value={slots.breakfast} 
                  isChanged={lastChangedSlot === `${day}-breakfast`}
                  onClick={() => {
                    setEditingSlot({ day, type: 'breakfast' });
                    setEditValue(slots.breakfast);
                    setIsEditSheetOpen(true);
                  }}
                />
                <div className="h-[1px] bg-[#D4CEC4]/50" />
                <MealRow 
                  label="LUNCH" 
                  value={slots.lunch} 
                  isChanged={lastChangedSlot === `${day}-lunch`}
                  onClick={() => {
                    setEditingSlot({ day, type: 'lunch' });
                    setEditValue(slots.lunch);
                    setIsEditSheetOpen(true);
                  }}
                />
                <div className="h-[1px] bg-[#D4CEC4]/50" />
                <MealRow 
                  label="DINNER" 
                  value={slots.dinner} 
                  isChanged={lastChangedSlot === `${day}-dinner`}
                  onClick={() => {
                    setEditingSlot({ day, type: 'dinner' });
                    setEditValue(slots.dinner);
                    setIsEditSheetOpen(true);
                  }}
                />
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Smart Grocery Button */}
      <div className="fixed bottom-[100px] left-0 right-0 px-6 z-40">
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={generateGroceries}
          disabled={isGeneratingGroceries}
          className="w-full h-14 bg-[#1A1A1A] text-white rounded-full font-outfit font-medium flex items-center justify-center gap-2 shadow-xl disabled:opacity-50"
        >
          {isGeneratingGroceries ? (
            <Loader2 className="animate-spin" size={20} />
          ) : (
            <Sparkles size={18} className="text-[#B8955A]" />
          )}
          Add this week's meals to grocery list →
        </motion.button>
      </div>

      {/* Edit Sheet */}
      <BottomSheet 
        isOpen={isEditSheetOpen} 
        onClose={() => setIsEditSheetOpen(false)}
        footer={
          <div className="flex flex-col gap-3">
            <button
              onClick={handleSaveMeal}
              className="w-full h-14 bg-[#1A1A1A] text-white rounded-full font-outfit font-medium text-lg shadow-lg"
            >
              Save ✦
            </button>
            {editValue && (
              <button
                onClick={handleClearMeal}
                className="w-full h-10 bg-transparent text-[#6B6560] rounded-full font-outfit text-sm"
              >
                Clear
              </button>
            )}
          </div>
        }
      >
        <div className="py-4 space-y-6">
          <div>
            <p className="font-serif text-[22px] text-[#1A1A1A] mb-4 capitalize">
              {editingSlot?.day} · {editingSlot?.type}
            </p>
            <input
              autoFocus
              placeholder="What are you having?"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="w-full bg-transparent border-none focus:ring-0 font-serif text-[24px] text-[#1A1A1A] placeholder-[#D4CEC4] p-0"
            />
          </div>

          {suggestions.length > 0 && (
            <div className="space-y-3">
              <p className="font-outfit text-[11px] font-bold text-[#6B6560] uppercase tracking-widest">Recent Picks</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map(s => (
                  <button
                    key={s}
                    onClick={() => setEditValue(s)}
                    className="px-4 py-2 rounded-full bg-white border border-[#D4CEC4] font-outfit text-sm text-[#1A1A1A]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}

function MealRow({ label, value, onClick, isChanged }: { label: string, value: string, onClick: () => void, isChanged: boolean }) {
  return (
    <div 
      onClick={onClick}
      className={`group cursor-pointer transition-colors duration-500 rounded-lg -mx-2 px-2 py-1 ${
        isChanged ? 'bg-[#B8955A]/20' : 'hover:bg-[#1A1A1A]/5'
      }`}
    >
      <p className="font-outfit text-[11px] font-bold text-[#B8955A] uppercase tracking-widest mb-1">{label}</p>
      {value ? (
        <p className="font-outfit text-[15px] text-[#1A1A1A]">{value}</p>
      ) : (
        <p className="font-outfit text-[14px] italic text-[#D4CEC4]">Add something...</p>
      )}
    </div>
  );
}
