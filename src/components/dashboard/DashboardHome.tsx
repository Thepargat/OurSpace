import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence, useScroll, useTransform, animate } from "motion/react";
import { 
  doc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  Timestamp,
  getDoc,
  updateDoc,
  getDocs
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../AuthWrapper";
import { format, differenceInDays, isSameMonth } from "date-fns";
import { getOrUpdateInsights, Insight } from "../../services/relationshipIntelligence";
import { startProactiveBrain, ProactiveAlert } from "../../services/proactiveBrain";
import { getSpecialDates, SpecialDate } from "../../services/specialDatesService";
import { cn } from "../../lib/utils";

// --- Design Constants ---
const EASE_OUT = [0.16, 1, 0.3, 1];

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20, filter: "blur(10px)" },
  show: { 
    opacity: 1, 
    y: 0, 
    filter: "blur(0px)",
    transition: { duration: 0.6, ease: EASE_OUT }
  }
};

// --- Helper: Count Up Animation ---
function CountUp({ end, duration = 2 }: { end: number, duration?: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const controls = animate(0, end, {
      duration,
      onUpdate: (value) => setCount(Math.floor(value)),
    });
    return () => controls.stop();
  }, [end, duration]);
  return <>{count.toLocaleString()}</>;
}

export default function DashboardHome({ onNavigate }: { onNavigate: (t: string) => void }) {
  const { user, householdId, userData } = useAuth();
  const [partnerData, setPartnerData] = useState<any>(null);
  const [lastMemory, setLastMemory] = useState<any>(null);
  const [milestones, setMilestones] = useState({ met: 0, married: 0 });
  const [pulseData, setPulseData] = useState({
    birthday: { name: "", days: 0 },
    chores: { count: 0 },
    goal: { name: "", progress: 0 },
    shopping: { event: "" }
  });
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [alerts, setAlerts] = useState<ProactiveAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 500], [0, 150]);
  const heroOpacity = useTransform(scrollY, [0, 300], [1, 0.5]);

  // Data Loading
  useEffect(() => {
    if (!householdId || !user) return;

    // 1. Partner & Household
    const unsubHousehold = onSnapshot(doc(db, "households", householdId), async (snap) => {
      const hData = snap.data();
      const pId = hData?.memberIds?.find((id: string) => id !== user.uid);
      
      if (hData?.createdAt) {
        const metDate = hData.createdAt.toDate();
        setMilestones(m => ({ ...m, met: differenceInDays(new Date(), metDate) }));
      }

      if (pId) {
        onSnapshot(doc(db, "users", pId), (pSnap) => {
          const pData = pSnap.data();
          setPartnerData(pData);
          
          if (pData?.birthday) {
            const bday = new Date(pData.birthday);
            const today = new Date();
            bday.setFullYear(today.getFullYear());
            if (bday < today) bday.setFullYear(today.getFullYear() + 1);
            setPulseData(p => ({ ...p, birthday: { name: pData.displayName || "Partner", days: differenceInDays(bday, today) } }));
          }

          if (pData?.anniversaryDate) {
            setMilestones(m => ({ ...m, married: differenceInDays(new Date(), new Date(pData.anniversaryDate)) }));
          }
        });
      }
    });

    // 2. Last Memory
    const unsubMemory = onSnapshot(query(collection(db, "households", householdId, "memories"), orderBy("date", "desc"), limit(1)), (snap) => {
      setLastMemory(snap.docs[0]?.data());
      setIsLoading(false);
    });

    // 3. Chores
    const unsubChores = onSnapshot(query(collection(db, "households", householdId, "chores"), where("completed", "==", false)), (snap) => {
      setPulseData(p => ({ ...p, chores: { count: snap.size } }));
    });

    // 4. Goals
    const unsubGoals = onSnapshot(query(collection(db, "households", householdId, "savingsGoals"), orderBy("currentAmount", "desc"), limit(1)), (snap) => {
      const goal = snap.docs[0]?.data();
      if (goal) {
        const progress = (goal.currentAmount / goal.targetAmount) * 100;
        setPulseData(p => ({ ...p, goal: { name: goal.title, progress } }));
      }
    });

    // 5. Calendar
    const unsubEvents = onSnapshot(query(collection(db, "households", householdId, "events"), where("date", ">=", Timestamp.now()), orderBy("date", "asc"), limit(1)), (snap) => {
      setPulseData(p => ({ ...p, shopping: { event: snap.docs[0]?.data()?.title || "No events" } }));
    });

    return () => {
      unsubHousehold();
      unsubMemory();
      unsubChores();
      unsubGoals();
      unsubEvents();
    };
  }, [householdId, user?.uid]);

  // Proactive Brain & Insights
  useEffect(() => {
    if (!householdId || !user) return;
    
    // Start Proactive Brain (non-UI service)
    const pId = partnerData?.uid;
    if (pId) {
      const stopBrain = startProactiveBrain(householdId, user.uid, pId);
      return () => stopBrain();
    }
  }, [householdId, user?.uid, partnerData?.uid]);

  return (
    <div className="min-h-full bg-background" ref={containerRef}>
      {/* TopAppBar */}
      <header className="fixed top-0 left-0 right-0 h-20 px-6 flex items-center justify-between bg-background/80 backdrop-blur-xl z-[100]">
        <motion.div 
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="w-10 h-10 rounded-full overflow-hidden border-2 border-primary/10 shadow-sm"
        >
          <img src={userData?.photoURL || "https://api.dicebear.com/7.x/avataaars/svg?seed=user"} className="w-full h-full object-cover" />
        </motion.div>
        
        <h1 className="font-serif text-2xl italic text-primary">Together</h1>
        
        <button onClick={() => onNavigate('settings')} className="w-10 h-10 flex items-center justify-center text-primary">
          <span className="material-symbols-outlined text-[28px]">settings</span>
        </button>
      </header>

      <motion.main 
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="pt-24 pb-32 px-6 space-y-8"
      >
        {/* Hero Parallax Section */}
        <motion.section 
          style={{ y: heroY, opacity: heroOpacity }}
          className="relative h-56 w-full rounded-card-lg overflow-hidden shadow-card"
        >
          {lastMemory ? (
            <img src={lastMemory.imageURL} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/10 to-surface-container" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-on-surface/40 to-transparent" />
          <div className="absolute bottom-6 left-6 right-6">
            <p className="font-jakarta text-[10px] uppercase tracking-[0.2em] text-white/70 font-bold mb-1">Last Story</p>
            <h3 className="font-serif text-xl text-white italic">{lastMemory?.caption || "A new memory awaits"}</h3>
          </div>
        </motion.section>

        {/* Presence & Heartbeat */}
        <motion.section variants={itemVariants} className="flex items-center justify-between px-2">
          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-surface-container p-1 ring-2 ring-primary/5">
                <img src={userData?.photoURL} className="w-full h-full rounded-full object-cover" />
              </div>
              <div className="absolute bottom-0 right-1 w-4 h-4 rounded-full bg-green-500 border-2 border-white shadow-sm" />
            </div>
            <p className="text-[11px] font-jakarta font-bold text-on-surface">YOU</p>
          </div>

          <div className="flex flex-col items-center">
            <motion.span 
              animate={{ 
                scale: [1, 1.25, 1, 1.25, 1],
                filter: ["drop-shadow(0 0 5px rgba(188,1,0,0.2))", "drop-shadow(0 0 15px rgba(188,1,0,0.4))", "drop-shadow(0 0 5px rgba(188,1,0,0.2))"]
              }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", times: [0, 0.1, 0.2, 0.3, 1] }}
              className="material-symbols-outlined text-[56px] text-primary fill-1"
            >
              favorite
            </motion.span>
            <p className="text-[9px] font-jakarta font-extrabold text-primary tracking-widest mt-1">LUB-DUB</p>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-surface-container p-1 ring-2 ring-primary/5">
                <img src={partnerData?.photoURL} className="w-full h-full rounded-full object-cover" />
                {partnerData?.isOnline && (
                  <>
                    <motion.div 
                      animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                      className="absolute inset-0 border-2 border-primary rounded-full z-[-1]" 
                    />
                    <motion.div 
                      animate={{ scale: [1, 2.5], opacity: [0.3, 0] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 0.6 }}
                      className="absolute inset-0 border border-primary rounded-full z-[-1]" 
                    />
                  </>
                )}
              </div>
              <div className={cn(
                "absolute bottom-0 right-1 w-4 h-4 rounded-full border-2 border-white shadow-sm transition-colors duration-500",
                partnerData?.isOnline ? "bg-green-500" : "bg-stone-300"
              )} />
            </div>
            <p className="text-[11px] font-jakarta font-bold text-on-surface uppercase">{partnerData?.displayName?.split(' ')[0] || "PARTNER"}</p>
          </div>
        </motion.section>

        {/* Milestones Grid */}
        <motion.section variants={itemVariants} className="grid grid-cols-2 gap-4">
          <div className="bg-surface p-6 rounded-card shadow-card space-y-1">
            <p className="font-serif text-3xl font-bold text-on-surface leading-none">
              <CountUp end={milestones.met || 0} />
            </p>
            <p className="text-[11px] font-jakarta text-on-surface-variant/60 font-medium uppercase tracking-wider">Days Since Met</p>
          </div>
          <div className="bg-surface p-6 rounded-card shadow-card space-y-1">
            <p className="font-serif text-3xl font-bold text-on-surface leading-none">
              <CountUp end={milestones.married || 0} />
            </p>
            <p className="text-[11px] font-jakarta text-on-surface-variant/60 font-medium uppercase tracking-wider">Days Married</p>
          </div>
        </motion.section>

        {/* Daily Pulse (2x2 Grid) */}
        <motion.section variants={itemVariants} className="grid grid-cols-2 gap-4">
          {/* Birthday Card */}
          <motion.div 
            whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }}
            className="h-40 bg-surface p-5 rounded-card shadow-card border-l-4 border-secondary flex flex-col justify-between"
          >
            <span className="material-symbols-outlined text-secondary text-[28px] fill-1">cake</span>
            <div className="space-y-0.5">
              <p className="text-[10px] font-bold text-on-surface/30 uppercase tracking-[0.15em]">Birthday</p>
              <p className="text-[13px] font-bold text-on-surface leading-tight">
                {pulseData.birthday.name}'s Big Day<br/>
                <span className="text-secondary font-medium">in {pulseData.birthday.days} days</span>
              </p>
            </div>
          </motion.div>

          {/* Chores/Tasks Card */}
          <motion.div 
            whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }}
            onClick={() => onNavigate('tasks')}
            className="h-40 bg-surface p-5 rounded-card shadow-card border-l-4 border-tertiary flex flex-col justify-between"
          >
            <span className="material-symbols-outlined text-tertiary text-[28px] fill-1">assignment</span>
            <div className="space-y-0.5">
              <p className="text-[10px] font-bold text-on-surface/30 uppercase tracking-[0.15em]">Daily Tasks</p>
              <p className="text-[13px] font-bold text-on-surface leading-tight">
                {pulseData.chores.count} Items Pending<br/>
                <span className="text-tertiary font-medium">household chores</span>
              </p>
            </div>
          </motion.div>

          {/* Goal Progress Card */}
          <motion.div 
            whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }}
            onClick={() => onNavigate('finances')}
            className="h-40 bg-surface p-5 rounded-card shadow-card border-l-4 border-primary flex flex-col justify-between"
          >
            <span className="material-symbols-outlined text-primary text-[28px] fill-1">savings</span>
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-on-surface/30 uppercase tracking-[0.15em]">Focus Goal</p>
              <div className="space-y-1">
                <p className="text-[13px] font-bold text-on-surface truncate">{pulseData.goal.name || "Main Savings"}</p>
                <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${pulseData.goal.progress || 0}%` }}
                    transition={{ duration: 1.5, ease: "easeOut", delay: 0.5 }}
                    className="h-full bg-primary" 
                  />
                </div>
              </div>
            </div>
          </motion.div>

          {/* Next Calendar Event Card */}
          <motion.div 
            whileHover={{ y: -4 }} whileTap={{ scale: 0.97 }}
            onClick={() => onNavigate('calendar')}
            className="h-40 bg-surface p-5 rounded-card shadow-card border-l-4 border-amber-500 flex flex-col justify-between"
          >
            <span className="material-symbols-outlined text-amber-600 text-[28px] fill-1">shopping_cart</span>
            <div className="space-y-0.5">
              <p className="text-[10px] font-bold text-on-surface/30 uppercase tracking-[0.15em]">Next Event</p>
              <p className="text-[13px] font-bold text-on-surface truncate">{pulseData.shopping.event}</p>
            </div>
          </motion.div>
        </motion.section>

        {/* Dynamic AI Insights Footer */}
        {insights && insights.length > 0 && (
          <motion.section variants={itemVariants} className="pt-4">
            <div className="bg-surface-container/50 border border-outline/10 p-6 rounded-card space-y-3">
              <div className="flex items-center gap-2 text-primary">
                <span className="material-symbols-outlined text-[20px] fill-1">sparkles</span>
                <p className="text-[11px] font-bold uppercase tracking-widest">A Moment for Us</p>
              </div>
              <p className="font-serif italic text-on-surface leading-normal text-base">
                "{insights[0].text}"
              </p>
            </div>
          </motion.section>
        )}
      </motion.main>
    </div>
  );
}
