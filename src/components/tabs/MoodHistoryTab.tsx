import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy,
  Timestamp 
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../AuthWrapper";
import { format, subDays, eachDayOfInterval } from "date-fns";
import { MOOD_EMOJIS, MoodEntry } from "../../services/moodService";
import { ChevronLeft } from "lucide-react";
import { getDoc, doc } from "firebase/firestore";

interface MoodHistoryTabProps {
  onBack: () => void;
}

export default function MoodHistoryTab({ onBack }: MoodHistoryTabProps) {
  const { user, householdId } = useAuth();
  const [moods, setMoods] = useState<MoodEntry[]>([]);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [partnerData, setPartnerData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!householdId || !user) return;

    const fetchData = async () => {
      // Get partner ID
      const hSnap = await getDoc(doc(db, "households", householdId));
      const hData = hSnap.data();
      const pId = hData?.memberIds?.find((id: string) => id !== user.uid);
      setPartnerId(pId || null);

      if (pId) {
        const pSnap = await getDoc(doc(db, "users", pId));
        setPartnerData(pSnap.data());
      }

      // Get moods for last 30 days
      const thirtyDaysAgo = subDays(new Date(), 30);
      const q = query(
        collection(db, "households", householdId, "moods"),
        where("createdAt", ">=", Timestamp.fromDate(thirtyDaysAgo)),
        orderBy("createdAt", "desc")
      );
      
      const snap = await getDocs(q);
      setMoods(snap.docs.map(d => d.data() as MoodEntry));
      setLoading(false);
    };

    fetchData();
  }, [householdId, user]);

  const days = eachDayOfInterval({
    start: subDays(new Date(), 29),
    end: new Date()
  }).reverse();

  return (
    <div className="min-h-screen bg-[#F8F4EE] pb-20">
      <header className="pt-16 pb-6 px-6 flex items-center gap-4">
        <button onClick={onBack} className="p-2 -ml-2 text-[#6B6560]">
          <ChevronLeft size={24} />
        </button>
        <h1 className="font-serif text-2xl text-[#1A1A1A]">Mood History</h1>
      </header>

      <div className="px-6 space-y-3">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          days.map((day, i) => {
            const dateStr = format(day, "yyyy-MM-dd");
            const myDayMood = moods.find(m => m.userId === user?.uid && m.date === dateStr);
            const partnerDayMood = moods.find(m => m.userId === partnerId && m.date === dateStr);

            const isHigh = myDayMood && partnerDayMood && myDayMood.mood >= 4 && partnerDayMood.mood >= 4;
            const isLow = (myDayMood && myDayMood.mood <= 2) || (partnerDayMood && partnerDayMood.mood <= 2);

            return (
              <motion.div
                key={dateStr}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className={`p-4 rounded-[20px] border flex flex-col gap-4 ${
                  isHigh ? 'bg-[#F0E4CC] border-[#B8955A]/30' : 
                  isLow ? 'bg-[#F5E6E0] border-[#C47B6A]/30' : 
                  'bg-[#EDE8DF] border-[#D4CEC4]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-outfit text-[11px] uppercase tracking-wider text-[#6B6560]">
                      {format(day, "EEE, d MMM")}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-xl">{myDayMood ? MOOD_EMOJIS[myDayMood.mood - 1] : "—"}</span>
                      <span className="font-outfit text-[9px] text-[#6B6560] uppercase">You</span>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-xl">{partnerDayMood ? MOOD_EMOJIS[partnerDayMood.mood - 1] : "—"}</span>
                      <span className="font-outfit text-[9px] text-[#6B6560] uppercase">Partner</span>
                    </div>
                  </div>
                </div>

                {isLow && (
                  <div className="pt-3 border-t border-charcoal/5 flex items-center justify-between">
                    <p className="font-outfit text-[12px] text-warm-grey italic">
                      {myDayMood?.mood <= 2 ? "You were feeling a bit low." : "Partner was feeling a bit low."}
                    </p>
                    <button className="font-outfit text-[11px] text-brass font-bold uppercase tracking-wider">
                      Check in with {myDayMood?.mood <= 2 ? "Partner" : (partnerData?.displayName || "Partner")}
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
