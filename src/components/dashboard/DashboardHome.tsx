import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
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
import { format, isSameMonth, isSameDay, differenceInYears, isSunday } from "date-fns";
import { getOrUpdateInsights, Insight } from "../../services/relationshipIntelligence";
import { startProactiveBrain, ProactiveAlert } from "../../services/proactiveBrain";
import { X, Heart, Gift, Sparkles } from "lucide-react";
import { saveMood, MOOD_EMOJIS, MoodEntry } from "../../services/moodService";
import { getSpecialDates, SpecialDate, checkReminders, getEarliestMemory } from "../../services/specialDatesService";
import { generateWeeklySummary, dismissWeeklySummary, WeeklySummary } from "../../services/weeklySummaryService";
import confetti from "canvas-confetti";
import BottomSheet from "../ui/BottomSheet";
import { GoogleGenAI, Type } from "@google/genai";

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

interface PartnerData {
  displayName: string;
  photoURL: string;
  isOnline: boolean;
  lastSeen: Timestamp;
}

interface EventData {
  title: string;
  date: Timestamp;
}

interface MemoryData {
  imageUrl: string;
  caption: string;
  createdAt: Timestamp;
}

interface NoteData {
  text: string;
  authorName: string;
  createdAt: Timestamp;
}

// --- Animation Constants ---
const spring = { type: "spring" as const, stiffness: 280, damping: 22 };

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 40, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { ...spring, delay }
});

const cardHover = {
  y: -6,
  boxShadow: "0 12px 32px rgba(26,26,26,0.12)",
  transition: { type: "spring" as const, stiffness: 300, damping: 20 }
};

const cardTap = { scale: 0.98 };

// --- Helper Components ---
const ensureDate = (val: any): Date | null => {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val.toDate === 'function') return val.toDate();
  if (typeof val === 'object' && val.seconds !== undefined) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const Section = ({ children, delay = 0, className = "", id }: { children: React.ReactNode, delay?: number, className?: string, id?: string }) => (
  <motion.section 
    layout
    {...fadeUp(delay)}
    id={id}
    className={`w-full px-5 ${className}`}
  >
    {children}
  </motion.section>
);

const Card = ({ children, onClick, className = "", layoutId }: { children: React.ReactNode, onClick?: () => void, className?: string, layoutId?: string }) => (
  <motion.div
    layoutId={layoutId}
    whileHover={onClick ? { ...cardHover, backgroundColor: "rgba(255, 255, 255, 0.6)" } : undefined}
    whileTap={onClick ? cardTap : undefined}
    onClick={onClick}
    className={`glass-card border border-stone/30 rounded-[28px] overflow-hidden ${onClick ? 'cursor-pointer' : ''} ${className}`}
    style={{
      background: "var(--glass-bg)",
      backdropFilter: "var(--glass-blur)",
      boxShadow: "var(--glass-shadow)"
    }}
  >
    {children}
  </motion.div>
);

const LivePulse = ({ active }: { active: boolean }) => (
  <div className="flex items-center gap-2 px-3 py-1 bg-white/40 backdrop-blur-md rounded-full border border-white/50 shadow-sm">
    <div className="relative w-2 h-2">
      <div className={`absolute inset-0 rounded-full bg-green-500 ${active ? 'animate-[pulse-live_2s_infinite]' : ''}`} />
      <div className="absolute inset-0 rounded-full bg-green-500/40 blur-[2px]" />
    </div>
    <span className="font-outfit text-[10px] uppercase tracking-widest font-bold text-charcoal/60">
      {active ? "Live Syncing" : "Connected"}
    </span>
  </div>
);

const EmptyState = ({ text }: { text: string }) => (
  <p className="font-outfit italic text-stone text-sm">{text}</p>
);

// --- Main Component ---
interface DashboardHomeProps {
  onNavigate: (tab: string) => void;
}

export default function DashboardHome({ onNavigate }: DashboardHomeProps) {
  const { user } = useAuth();
  const [userData, setUserData] = useState<any>(null);
  const [partnerData, setPartnerData] = useState<PartnerData | null>(null);
  const [nextEvent, setNextEvent] = useState<EventData | null>(null);
  const [groceryCount, setGroceryCount] = useState(0);
  const [monthlySpend, setMonthlySpend] = useState(0);
  const [lastMemory, setLastMemory] = useState<MemoryData | null>(null);
  const [lastNote, setLastNote] = useState<NoteData | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [alerts, setAlerts] = useState<ProactiveAlert[]>([]);
  const [myMood, setMyMood] = useState<MoodEntry | null>(null);
  const [partnerMood, setPartnerMood] = useState<MoodEntry | null>(null);
  const [specialDates, setSpecialDates] = useState<SpecialDate[]>([]);
  const [isAnniversary, setIsAnniversary] = useState(false);
  const [isPartnerBirthday, setIsPartnerBirthday] = useState(false);
  const [earliestMemory, setEarliestMemory] = useState<any>(null);
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [selectedDateForGifts, setSelectedDateForGifts] = useState<SpecialDate | null>(null);
  const [giftSuggestions, setGiftSuggestions] = useState<any[]>([]);
  const [loadingGifts, setLoadingGifts] = useState(false);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [startY, setStartY] = useState(0);
  const [pullOffset, setPullOffset] = useState(0);

  // --- Error Handler ---
  const handleError = (error: any, op: OperationType, path: string) => {
    const errInfo: FirestoreErrorInfo = {
      error: error.message,
      operationType: op,
      path,
      authInfo: {
        userId: user?.uid,
        email: user?.email,
        emailVerified: user?.emailVerified,
        isAnonymous: user?.isAnonymous,
        tenantId: user?.tenantId,
        providerInfo: user?.providerData.map(p => ({
          providerId: p.providerId,
          displayName: p.displayName,
          email: p.email,
          photoUrl: p.photoURL
        })) || []
      }
    };
    console.error('Firestore Error:', JSON.stringify(errInfo));
  };

  // --- Time-aware Logic ---
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const sydneyTime = useMemo(() => {
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      hour: "numeric",
      hour12: false
    }).format(currentTime);
  }, [currentTime]);

  const hour = parseInt(sydneyTime);
  
  const timeConfig = useMemo(() => {
    if (isAnniversary) return { bg: "linear-gradient(to bottom, #F5EDD8, #F8F4EE)", greeting: "Happy Anniversary! 🎉", dark: false };
    if (isPartnerBirthday) return { bg: "#F8F4EE", greeting: `It's ${partnerData?.displayName || 'Partner'}'s birthday today! 🎂`, dark: false };
    
    if (hour >= 5 && hour < 10) return { bg: "#E8EEF4", greeting: "Good Morning", dark: false };
    if (hour >= 10 && hour < 15) return { bg: "#F8F4EE", greeting: "Good Afternoon", dark: false };
    if (hour >= 15 && hour < 19) return { bg: "#F5EDD8", greeting: "Golden Hour", dark: false };
    return { bg: "#1A1A1A", greeting: "Good Evening", dark: true };
  }, [hour]);

  // --- Data Fetching ---
  useEffect(() => {
    if (!user) return;

    // 1. User Data
    const userPath = `users/${user.uid}`;
    const unsubUser = onSnapshot(doc(db, "users", user.uid), 
      (snapshot) => {
        setIsSyncing(true);
        setUserData(snapshot.data());
        setTimeout(() => setIsSyncing(false), 800);
      },
      (err) => handleError(err, OperationType.GET, userPath)
    );

    // 2. Partner Data
    let unsubPartner: (() => void) | null = null;
    let unsubHousehold: (() => void) | null = null;
    let unsubEvent: (() => void) | null = null;
    let unsubGroceries: (() => void) | null = null;
    let unsubExpenses: (() => void) | null = null;
    let unsubMemory: (() => void) | null = null;
    let unsubNote: (() => void) | null = null;

    if (userData?.householdId) {
      const householdPath = `households/${userData.householdId}`;
      
      // Fetch Special Dates
      const fetchSpecial = async () => {
        const hSnap = await getDoc(doc(db, "households", userData.householdId));
        const hData = hSnap.data();
        const partnerId = hData?.memberIds?.find((id: string) => id !== user.uid);
        
        const dates = await getSpecialDates(userData.householdId, user.uid, partnerId || null);
        setSpecialDates(dates);
        checkReminders(userData.householdId, dates);

        // Check for Anniversary
        const annivDate = dates.find(d => d.type === 'anniversary');
        if (annivDate && annivDate.daysUntil === 0) {
          setIsAnniversary(true);
          const memory = await getEarliestMemory(userData.householdId);
          setEarliestMemory(memory);
          
          // Trigger Confetti
          confetti({
            colors: ["#B8955A", "#F0E4CC", "#C47B6A", "#E8A090"],
            particleCount: 120,
            spread: 100,
            origin: { y: 0.6 }
          });
        }

        // Check for Partner Birthday
        const partnerBday = dates.find(d => d.type === 'birthday' && d.name.includes("'s Birthday"));
        if (partnerBday && partnerBday.daysUntil === 0) {
          setIsPartnerBirthday(true);
        }
      };
      fetchSpecial();

      unsubHousehold = onSnapshot(doc(db, "households", userData.householdId), 
        (snapshot) => {
          const hData = snapshot.data();
          const partnerId = hData?.memberIds?.find((id: string) => id !== user.uid);
          
          if (partnerId) {
            const partnerPath = `users/${partnerId}`;
            if (unsubPartner) unsubPartner();
            unsubPartner = onSnapshot(doc(db, "users", partnerId), 
              (pSnap) => {
                setIsSyncing(true);
                setPartnerData(pSnap.data() as PartnerData);
                setTimeout(() => setIsSyncing(false), 800);
              },
              (err) => handleError(err, OperationType.GET, partnerPath)
            );
          } else {
            if (unsubPartner) unsubPartner();
            unsubPartner = null;
            setPartnerData(null);
          }
        },
        (err) => handleError(err, OperationType.GET, householdPath)
      );
      
      // 3. Next Event
      const eventsPath = `${householdPath}/events`;
      unsubEvent = onSnapshot(
        query(
          collection(db, "households", userData.householdId, "events"),
          where("date", ">=", Timestamp.now()),
          orderBy("date", "asc"),
          limit(1)
        ),
        (snap) => {
          setIsSyncing(true);
          setNextEvent(snap.docs[0]?.data() as EventData);
          setTimeout(() => setIsSyncing(false), 800);
        },
        (err) => handleError(err, OperationType.LIST, eventsPath)
      );

      // 4. Grocery Count
      const groceriesPath = `${householdPath}/groceries`;
      unsubGroceries = onSnapshot(
        query(
          collection(db, "households", userData.householdId, "groceries"),
          where("completed", "==", false)
        ),
        (snap) => {
          setIsSyncing(true);
          setGroceryCount(snap.size);
          setTimeout(() => setIsSyncing(false), 800);
        },
        (err) => handleError(err, OperationType.LIST, groceriesPath)
      );

      // 5. Monthly Spend
      const expensesPath = `${householdPath}/expenses`;
      unsubExpenses = onSnapshot(
        collection(db, "households", userData.householdId, "expenses"),
        (snap) => {
          const total = snap.docs
            .map(d => d.data())
            .filter(d => {
              const date = ensureDate(d.date);
              return date && isSameMonth(date, new Date());
            })
            .reduce((acc, curr) => acc + (curr.amount || curr.total || 0), 0);
          setIsSyncing(true);
          setMonthlySpend(total);
          setTimeout(() => setIsSyncing(false), 800);
        },
        (err) => handleError(err, OperationType.LIST, expensesPath)
      );

      // 6. Last Memory
      const memoriesPath = `${householdPath}/memories`;
      unsubMemory = onSnapshot(
        query(
          collection(db, "households", userData.householdId, "memories"),
          orderBy("createdAt", "desc"),
          limit(1)
        ),
        (snap) => {
          setIsSyncing(true);
          setLastMemory(snap.docs[0]?.data() as MemoryData);
          setTimeout(() => setIsSyncing(false), 800);
        },
        (err) => handleError(err, OperationType.LIST, memoriesPath)
      );

      // 7. Last Note
      const notesPath = `${householdPath}/notes`;
      unsubNote = onSnapshot(
        query(
          collection(db, "households", userData.householdId, "notes"),
          orderBy("createdAt", "desc"),
          limit(1)
        ),
        (snap) => {
          setIsSyncing(true);
          setLastNote(snap.docs[0]?.data() as NoteData);
          setTimeout(() => setIsSyncing(false), 800);
        },
        (err) => handleError(err, OperationType.LIST, notesPath)
      );

      // 8. Moods
      const today = new Date().toISOString().split('T')[0];
      const moodsRef = collection(db, "households", userData.householdId, "moods");
      const unsubMoods = onSnapshot(
        query(moodsRef, where("date", "==", today)),
        (snap) => {
          const todayMoods = snap.docs.map(d => d.data() as MoodEntry);
          setMyMood(todayMoods.find(m => m.userId === user.uid) || null);
          
          const hData = userData; // We already have householdId from userData
          const partnerId = hData?.memberIds?.find((id: string) => id !== user.uid);
          if (partnerId) {
            setPartnerMood(todayMoods.find(m => m.userId === partnerId) || null);
          }
        }
      );
    }

    return () => {
      unsubUser();
      if (unsubHousehold) unsubHousehold();
      if (unsubPartner) unsubPartner();
      if (unsubEvent) unsubEvent();
      if (unsubGroceries) unsubGroceries();
      if (unsubExpenses) unsubExpenses();
      if (unsubMemory) unsubMemory();
      if (unsubNote) unsubNote();
    };
  }, [user, userData?.householdId]);

  // --- Proactive Brain ---
  useEffect(() => {
    if (!userData?.householdId || !user) return;

    let stopBrain: (() => void) | null = null;
    let unsubAlerts: (() => void) | null = null;

    const initBrain = async () => {
      const hSnap = await getDoc(doc(db, "households", userData.householdId));
      const hData = hSnap.data();
      const pId = hData?.memberIds?.find((id: string) => id !== user.uid);
      
      if (pId) {
        stopBrain = startProactiveBrain(userData.householdId, user.uid, pId);
        
        // Listen for unread alerts
        const alertsRef = collection(db, 'households', userData.householdId, 'proactiveAlerts');
        const q = query(
          alertsRef, 
          where('read', '==', false), 
          orderBy('detectedAt', 'desc'),
          limit(3)
        );
        
        unsubAlerts = onSnapshot(q, (snap) => {
          setAlerts(snap.docs.map(d => ({ id: d.id, ...d.data() } as ProactiveAlert)));
        });
      }
    };

    initBrain();

    return () => {
      if (stopBrain) stopBrain();
      if (unsubAlerts) unsubAlerts();
    };
  }, [userData?.householdId, user?.uid]);

  // --- Insights Logic ---
  const fetchInsights = async (force = false) => {
    if (!userData?.householdId || !user) return;
    
    setLoadingInsights(true);
    try {
      const hSnap = await getDoc(doc(db, "households", userData.householdId));
      const hData = hSnap.data();
      const partnerId = hData?.memberIds?.find((id: string) => id !== user.uid);
      
      if (!partnerId) {
        setLoadingInsights(false);
        return;
      }

      const pSnap = await getDoc(doc(db, "users", partnerId));
      const pData = pSnap.data();

      const result = await getOrUpdateInsights(
        userData.householdId,
        user.uid,
        partnerId,
        userData.displayName || "You",
        pData?.displayName || "Partner",
        force
      );
      setInsights(result);
    } catch (err) {
      console.error("Error fetching insights:", err);
    } finally {
      setLoadingInsights(false);
    }
  };

  const fetchGiftSuggestions = async (date: SpecialDate) => {
    if (!userData?.householdId) return;
    setLoadingGifts(true);
    setSelectedDateForGifts(date);
    
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    
    // Get context
    const savingsSnap = await getDocs(collection(db, "households", userData.householdId, "savingsGoals"));
    const totalSavings = savingsSnap.docs.reduce((acc, d) => acc + (d.data().currentAmount || 0), 0);
    
    const bucketSnap = await getDocs(collection(db, "households", userData.householdId, "bucketList"));
    const interests = bucketSnap.docs.map(d => d.data().title).join(", ");

    const prompt = `Suggest 4 thoughtful gift ideas for a ${date.name} in ${date.daysUntil} days.
    Current savings available: $${totalSavings}
    Monthly budget remaining: $${(2000 - monthlySpend).toFixed(2)} (estimated)
    Their shared interests based on bucket list: ${interests || "travel, cooking, home improvement"}
    Return ONLY JSON array:
    [{ "emoji": "string", "name": "string", "description": "max 15 words", "estimatedCost": "string", "link": null }]`;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                emoji: { type: Type.STRING },
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                estimatedCost: { type: Type.STRING },
                link: { type: Type.NULL }
              },
              required: ["emoji", "name", "description", "estimatedCost"]
            }
          }
        }
      });
      
      setGiftSuggestions(JSON.parse(response.text || "[]"));
    } catch (err) {
      console.error("Gift suggestions failed:", err);
    } finally {
      setLoadingGifts(false);
    }
  };

  const fetchWeeklySummary = async () => {
    if (!userData?.householdId || !user) return;
    
    setLoadingSummary(true);
    try {
      // Get partner ID from household
      const hSnap = await getDoc(doc(db, "households", userData.householdId));
      const hData = hSnap.data();
      const partnerId = hData?.memberIds?.find((id: string) => id !== user.uid);

      if (!partnerId) {
        setLoadingSummary(false);
        return;
      }

      const summary = await generateWeeklySummary(
        userData.householdId,
        user.uid,
        userData.displayName || "You",
        partnerId,
        partnerData?.displayName || "Partner"
      );
      
      if (summary) {
        if (summary.dismissedAt && summary.generatedAt) {
          const dismissedDate = summary.dismissedAt.toDate();
          const generatedDate = summary.generatedAt.toDate();
          if (dismissedDate >= generatedDate) {
            setWeeklySummary(null);
          } else {
            setWeeklySummary(summary);
          }
        } else {
          setWeeklySummary(summary);
        }
      }
    } catch (error) {
      console.error("Error fetching weekly summary:", error);
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleDismissSummary = async () => {
    if (userData?.householdId) {
      await dismissWeeklySummary(userData.householdId);
      setWeeklySummary(null);
    }
  };

  useEffect(() => {
    if (userData?.householdId) {
      fetchInsights();
      fetchWeeklySummary();
      // Auto refresh every 24 hours
      const interval = setInterval(() => {
        fetchInsights();
        fetchWeeklySummary();
      }, 24 * 60 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [userData?.householdId, partnerData, user]);

  // --- Pull to Refresh Logic ---
  const REFRESH_THRESHOLD = 80;

  const handleTouchStart = (e: React.TouchEvent) => {
    const container = e.currentTarget as HTMLDivElement;
    if (container.scrollTop <= 0) {
      setStartY(e.touches[0].pageY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY === 0) return;
    const y = e.touches[0].pageY;
    const dist = y - startY;
    
    if (dist > 0) {
      // Dampened elastic effect: logarithmic-ish scaling
      const dampenedDist = Math.pow(dist, 0.85) * 2;
      setPullOffset(dampenedDist);
      
      // Prevent default scrolling when pulling
      if (dist > 10 && e.cancelable) {
        e.preventDefault();
      }
    }
  };

  const handleTouchEnd = () => {
    if (pullOffset > REFRESH_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      fetchInsights(true).then(() => {
        setIsRefreshing(false);
        setPullOffset(0);
        setStartY(0);
      });
    } else {
      setPullOffset(0);
      setStartY(0);
    }
  };

  const lastSeenText = useMemo(() => {
    const lastSeenDate = ensureDate(partnerData?.lastSeen);
    if (!lastSeenDate) return "";
    const diff = Math.floor((Date.now() - lastSeenDate.getTime()) / 60000);
    if (diff < 1) return "Just now";
    if (diff < 60) return `Last seen ${diff}m ago`;
    return `Last seen ${Math.floor(diff/60)}h ago`;
  }, [partnerData]);

  const handleDismissAlert = async (alertId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!userData?.householdId) return;
    await updateDoc(doc(db, 'households', userData.householdId, 'proactiveAlerts', alertId), {
      read: true
    });
  };

  const handleAlertClick = (alert: ProactiveAlert) => {
    // Map alert types to screens
    switch (alert.type) {
      case 'bill':
      case 'datenight':
        onNavigate('calendar');
        break;
      case 'grocery':
        onNavigate('grocery');
        break;
      case 'budget':
        onNavigate('finances');
        break;
      case 'chore':
        onNavigate('more'); // Assuming chores are in 'more' or have their own tab
        break;
      case 'savings':
        onNavigate('finances');
        break;
      case 'anniversary':
      case 'birthday':
        onNavigate('together');
        break;
    }
  };

  const handleMoodCheckIn = async (moodIndex: number) => {
    if (!userData?.householdId || !user) return;
    await saveMood(userData.householdId, user.uid, moodIndex + 1);
  };

  return (
    <div 
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        height: 'calc(100dvh - 84px)',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
        paddingBottom: 'calc(32px + env(safe-area-inset-bottom))',
        position: 'relative',
        background: '#FAF9F6' // Slightly brighter linen for better glass contrast
      }}
      className="no-scrollbar"
    >
      {/* Pull to Refresh Indicator */}
      <div 
        className="absolute top-0 left-0 right-0 flex justify-center z-50 pointer-events-none"
        style={{ height: pullOffset }}
      >
        <motion.div 
          animate={{ 
            y: pullOffset > 20 ? 40 : -40,
            opacity: pullOffset > 20 ? 1 : 0,
            rotate: pullOffset * 2,
            scale: isRefreshing ? [1, 1.1, 1] : pullOffset / REFRESH_THRESHOLD
          }}
          transition={isRefreshing ? { repeat: Infinity, duration: 1 } : { type: "spring", damping: 20 }}
          className="bg-white rounded-full p-2 shadow-xl border border-brass/20 text-brass"
        >
          <RefreshCw size={20} className={isRefreshing ? "animate-spin" : ""} />
        </motion.div>
      </div>

      {/* Mesh Background Overlay */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <motion.div 
          animate={{
            background: [
              `radial-gradient(circle at 20% 20%, ${timeConfig.bg}88 0%, transparent 40%)`,
              `radial-gradient(circle at 80% 80%, ${timeConfig.bg}88 0%, transparent 40%)`,
              `radial-gradient(circle at 20% 20%, ${timeConfig.bg}88 0%, transparent 40%)`,
            ]
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="w-full h-full opacity-40 blur-[100px]"
        />
      </div>

      {/* Section 1: Time-aware Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={() => onNavigate('calendar')}
        className="relative z-10 w-full pt-16 pb-12 px-8 cursor-pointer"
      >
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <h1 
              className="font-serif text-[44px] font-light leading-tight tracking-tight"
              style={{ color: timeConfig.dark ? "#F8F4EE" : "#1A1A1A" }}
            >
              {timeConfig.greeting}
            </h1>
            <p 
              className="font-outfit text-lg opacity-60"
              style={{ color: timeConfig.dark ? "#D4CEC4" : "#6B6560" }}
            >
              {userData?.displayName?.split(' ')[0] || "there"}
            </p>
          </div>
          <LivePulse active={isSyncing} />
        </div>
        
        <div className="mt-8 flex items-center gap-3">
          <div className="h-[1px] flex-1 bg-stone/20" />
          <p 
            className="font-outfit text-[11px] uppercase tracking-[3px] font-bold text-brass"
          >
            {format(currentTime, "EEEE, d MMM")}
          </p>
          <div className="h-[1px] flex-1 bg-stone/20" />
        </div>
      </motion.header>

      <div className="relative z-10 space-y-8 mt-2">
        {/* Coming Up Countdown */}
        {specialDates.length > 0 && (
          <Section delay={0.03}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-outfit text-[11px] tracking-[2px] uppercase text-brass font-medium">
                Coming Up
              </p>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-4 -mx-5 px-5 no-scrollbar snap-x">
              {specialDates.map((date) => (
                <motion.div
                  key={date.id}
                  onClick={() => fetchGiftSuggestions(date)}
                  whileTap={{ scale: 0.98 }}
                  className={`flex-shrink-0 w-[240px] bg-white/40 backdrop-blur-md border border-white/50 rounded-[28px] p-6 snap-start cursor-pointer relative overflow-hidden shadow-sm ${
                    date.daysUntil <= 1 ? 'border-l-[4px] border-l-rose-urgent' : 
                    date.daysUntil <= 7 ? 'border-l-[4px] border-l-brass' : ''
                  }`}
                >
                  {date.daysUntil <= 1 && (
                    <motion.div 
                      animate={{ 
                        boxShadow: [
                          "inset 0 0 0px rgba(196, 123, 106, 0)",
                          "inset 0 0 20px rgba(196, 123, 106, 0.2)",
                          "inset 0 0 0px rgba(196, 123, 106, 0)"
                        ]
                      }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute inset-0 pointer-events-none"
                    />
                  )}
                  <div className="relative z-10">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-2xl">{date.emoji}</span>
                      <Gift size={16} className="text-stone" />
                    </div>
                    <div className="font-serif text-[48px] text-charcoal leading-none mb-1">
                      {date.daysUntil}
                    </div>
                    <div className="font-outfit text-[12px] text-warm-grey">
                      days until {date.name}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </Section>
        )}

        {/* Anniversary Memory Card */}
        {isAnniversary && earliestMemory && (
          <Section delay={0.035}>
            <Card className="p-0 overflow-hidden border-brass/40">
              <div className="relative aspect-video">
                <img 
                  src={earliestMemory.imageUrl} 
                  alt="" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-charcoal/80 to-transparent flex flex-col justify-end p-6">
                  <p className="font-outfit text-[12px] text-white/70 uppercase tracking-widest mb-1">
                    On this day {differenceInYears(new Date(), earliestMemory.date?.toDate() || new Date())} years ago...
                  </p>
                  <p className="font-serif text-[20px] text-white italic">
                    {earliestMemory.caption || "Where it all began."}
                  </p>
                </div>
              </div>
            </Card>
          </Section>
        )}

        {/* Mood Check-in / Status */}
        <Section delay={0.04}>
          <AnimatePresence mode="wait">
            {!myMood ? (
              <motion.div
                key="check-in"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: { type: "spring", stiffness: 300, damping: 25 } }}
                className="glass-card border border-white/40 rounded-[28px] p-7 shadow-xl"
                style={{
                  background: "rgba(255, 255, 255, 0.45)",
                  backdropFilter: "blur(16px)",
                  boxShadow: "0 10px 40px rgba(0,0,0,0.05)"
                }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-brass animate-pulse" />
                  <p className="font-outfit text-[11px] uppercase tracking-[2px] text-warm-grey font-bold">Daily Check-in</p>
                </div>
                <div className="flex justify-between items-center bg-white/30 p-2 rounded-2xl border border-white/40">
                  {MOOD_EMOJIS.map((emoji, i) => (
                    <button
                      key={i}
                      onClick={() => handleMoodCheckIn(i)}
                      className="w-12 h-12 flex items-center justify-center text-2xl hover:bg-white/60 rounded-xl transition-all active:scale-90 hover:scale-110"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="mood-pill"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-center"
              >
                <div 
                  className="bg-white/60 border border-white/80 rounded-full px-5 py-2 flex items-center gap-3 shadow-lg backdrop-blur-md"
                >
                  <div className="flex items-center gap-2">
                    <motion.span layoutId="my-mood-emoji" className="text-xl">{MOOD_EMOJIS[myMood.mood - 1]}</motion.span>
                    <div className="w-[1px] h-3 bg-stone/30" />
                    {partnerMood ? (
                      <motion.span layoutId="partner-mood-emoji" className="text-xl">{MOOD_EMOJIS[partnerMood.mood - 1]}</motion.span>
                    ) : (
                      <div className="w-6 h-6 rounded-full border border-stone/30 border-dashed flex items-center justify-center">
                        <Heart size={12} className="text-stone/40 animate-pulse" />
                      </div>
                    )}
                  </div>
                  <span className="font-outfit text-[11px] text-warm-grey font-bold uppercase tracking-wider">
                    {partnerMood ? "Synchronized" : "Vibe check"}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>

        <Section delay={0.08}>
          <Card layoutId="partner-status" className="p-4 flex items-center justify-between group active:scale-[0.99] transition-transform">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-brass/20 rounded-full blur-md opacity-0 group-hover:opacity-100 transition-opacity" />
                <img 
                  src={partnerData?.photoURL || `https://ui-avatars.com/api/?name=${partnerData?.displayName || 'P'}&background=EDE8DF&color=1A1A1A`}
                  alt=""
                  className="relative w-14 h-14 rounded-full object-cover border-2 border-white shadow-md"
                  referrerPolicy="no-referrer"
                />
                <motion.div 
                  animate={partnerData?.isOnline ? { scale: [1, 1.2, 1] } : {}}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white ${partnerData?.isOnline ? 'bg-green-500' : 'bg-stone'}`}
                />
              </div>
              <div>
                <h2 className="font-serif text-[20px] text-charcoal leading-tight">
                  {partnerData?.displayName || "Partner"}
                </h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${partnerData?.isOnline ? 'bg-green-500' : 'bg-stone'}`} />
                  <p className="font-outfit text-[11px] text-warm-grey uppercase tracking-wider font-bold">
                    {partnerData?.isOnline ? "Active Now" : lastSeenText}
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-stone/10 p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
              <ChevronRight size={16} className="text-stone" />
            </div>
          </Card>
        </Section>

        {/* Proactive Alerts Row */}
        {alerts.length > 0 && (
          <Section delay={0.12} className="!px-0">
            <div className="flex gap-3 overflow-x-auto no-scrollbar px-5 pb-2">
              {alerts.map((alert) => (
                <motion.div
                  key={alert.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9, x: 20 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.9, x: -20 }}
                  onClick={() => handleAlertClick(alert)}
                  className="relative min-w-[260px] flex-shrink-0 p-4 rounded-[16px] border flex items-center gap-4 cursor-pointer active:scale-[0.98] transition-transform shadow-sm"
                  style={{
                    background: alert.priority === 'high' ? '#F5E6E0' : '#EDE8DF',
                    borderColor: alert.priority === 'high' ? '#C47B6A' : '#D4CEC4'
                  }}
                >
                  <span className="text-2xl flex-shrink-0">
                    {alert.type === 'bill' && '💸'}
                    {alert.type === 'grocery' && '🛒'}
                    {alert.type === 'budget' && '📉'}
                    {alert.type === 'datenight' && '💝'}
                    {alert.type === 'chore' && '🧹'}
                    {alert.type === 'anniversary' && '🎉'}
                    {alert.type === 'birthday' && '🎂'}
                    {alert.type === 'savings' && '🎯'}
                  </span>
                  <p className="font-outfit text-[13px] text-[#1A1A1A] leading-[1.4] pr-4 flex-1">
                    {alert.message}
                  </p>
                  <button
                    onClick={(e) => handleDismissAlert(alert.id, e)}
                    className="absolute top-2 right-2 p-1 text-[#6B6560] hover:text-[#1A1A1A] transition-colors"
                  >
                    <X size={14} />
                  </button>
                </motion.div>
              ))}
            </div>
          </Section>
        )}

        {/* Section 3: Shared Dashboard Bento */}
        <Section delay={0.16}>
          <div className="grid grid-cols-12 gap-5 h-[240px]">
            {/* Main Tile: Next Event */}
            <Card 
              layoutId="next-event-card"
              onClick={() => onNavigate('calendar')}
              className="col-span-12 xs:col-span-7 p-6 flex flex-col justify-between group active:scale-[0.97] transition-all"
            >
              <div className="flex justify-between items-start">
                <div className="bg-brass/10 p-2 rounded-xl">
                  <Calendar size={20} className="text-brass group-hover:scale-110 transition-transform" />
                </div>
                <Sparkles size={16} className="text-brass/40 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              
              <div>
                <p className="font-outfit text-[10px] uppercase tracking-[2px] text-warm-grey mb-1 font-bold">Coming Up</p>
                {nextEvent ? (
                  <div className="space-y-1">
                    <h3 className="font-serif text-[22px] text-charcoal leading-tight line-clamp-2">{nextEvent.title}</h3>
                    <p className="font-outfit text-[14px] text-brass font-medium">
                      {ensureDate(nextEvent.date) ? format(ensureDate(nextEvent.date)!, "EEE, d MMM • h:mm a") : ""}
                    </p>
                  </div>
                ) : (
                  <EmptyState text="No upcoming events" />
                )}
              </div>
            </Card>

            <div className="col-span-12 xs:col-span-5 grid grid-cols-2 xs:grid-cols-1 gap-5">
              {/* Mini Tile: Groceries */}
              <Card 
                layoutId="grocery-mini-tile"
                onClick={() => onNavigate('grocery')}
                className="p-4 flex flex-col justify-center items-center text-center group"
              >
                <div className="relative">
                  <motion.span 
                    key={groceryCount}
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="block font-serif text-[32px] text-charcoal leading-none"
                  >
                    {groceryCount}
                  </motion.span>
                  <ShoppingCart size={14} className="absolute -right-4 top-0 text-stone opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <span className="font-outfit text-[11px] text-warm-grey uppercase tracking-wider font-bold mt-1">Groceries</span>
              </Card>

              {/* Mini Tile: Spend */}
              <Card 
                layoutId="finance-mini-tile"
                onClick={() => onNavigate('finances')}
                className="p-4 flex flex-col justify-center items-center text-center group"
              >
                <div className="relative">
                   <motion.span 
                    key={monthlySpend}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="block font-serif text-[24px] text-charcoal leading-none"
                  >
                    ${monthlySpend}
                  </motion.span>
                  <DollarSign size={14} className="absolute -right-4 top-0 text-stone opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <span className="font-outfit text-[11px] text-warm-grey uppercase tracking-wider font-bold mt-1">This Month</span>
              </Card>
            </div>
          </div>
        </Section>

        {/* Section 4: Last Memory */}
        <Section delay={0.24}>
          <Card layoutId="last-memory" onClick={() => onNavigate('together')} className="group cursor-pointer p-0 border-white/40">
            <div className="aspect-[16/7] w-full relative bg-stone/10 overflow-hidden">
              {lastMemory ? (
                <>
                  <img 
                    src={lastMemory.imageUrl} 
                    alt="" 
                    className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-charcoal/60 via-transparent to-transparent opacity-60 group-hover:opacity-80 transition-opacity" />
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <EmptyState text="Add your first memory together" />
                </div>
              )}
            </div>
            {lastMemory && (
              <div className="p-5 flex items-center justify-between">
                <p className="font-outfit text-[13px] text-warm-grey line-clamp-1 italic pr-4">
                  "{lastMemory.caption}"
                </p>
                <Sparkles size={14} className="text-brass/40" />
              </div>
            )}
          </Card>
        </Section>

        {/* Section 5: Partner's Last Note */}
        <Section delay={0.32}>
          <Card layoutId="last-note" className="p-8 relative min-h-[160px] flex flex-col justify-center border-white/40">
            <span className="absolute top-4 left-6 font-serif text-[100px] text-brass/10 leading-none select-none italic">
              “
            </span>
            <div className="relative z-10 space-y-4">
              {lastNote ? (
                <>
                  <p className="font-serif italic text-[20px] text-charcoal leading-relaxed tracking-tight">
                    {lastNote.text}
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="h-[1px] w-6 bg-brass/30" />
                    <p className="font-outfit text-[11px] text-brass uppercase tracking-widest font-bold">
                      {lastNote.authorName || partnerData?.displayName || "Partner"}
                    </p>
                  </div>
                </>
              ) : (
                <EmptyState text="Nothing shared yet — surprise them with a note" />
              )}
            </div>
          </Card>
        </Section>

        {/* Section 6: Relationship Insights */}
        <Section delay={0.4} className="pb-12">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-outfit text-[11px] tracking-[2px] uppercase text-brass font-bold">
                Daily Insights
              </p>
              <div className="h-[1px] flex-1 bg-stone/10 ml-4" />
            </div>

            <AnimatePresence mode="wait">
              {loadingInsights ? (
                <motion.div 
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  {[1, 2].map(i => (
                    <div key={i} className="bg-white/30 border border-white/40 rounded-[24px] p-6 animate-pulse">
                      <div className="flex gap-4">
                        <div className="w-12 h-12 bg-stone/10 rounded-2xl" />
                        <div className="flex-1 space-y-3">
                          <div className="h-4 bg-stone/10 rounded w-1/3" />
                          <div className="h-3 bg-stone/10 rounded w-full" />
                        </div>
                      </div>
                    </div>
                  ))}
                </motion.div>
              ) : insights && insights.length > 0 ? (
                <motion.div 
                  key="insights"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-4"
                >
                  {insights.map((insight, i) => (
                    <motion.div 
                      key={i} 
                      whileHover={{ y: -4, backgroundColor: "rgba(255, 255, 255, 0.5)" }}
                      className="bg-white/40 border border-white/50 rounded-[24px] p-6 shadow-sm backdrop-blur-sm transition-colors"
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-12 h-12 flex items-center justify-center bg-white/60 rounded-2xl shadow-inner text-2xl flex-shrink-0">
                          {insight.emoji}
                        </div>
                        <div className="space-y-1.5 flex-1 pt-1">
                          <h3 className="font-serif text-[18px] text-[#1A1A1A] leading-tight font-bold">
                            {insight.title}
                          </h3>
                          <p className="font-outfit text-[13px] text-[#6B6560] leading-[1.6]">
                            {insight.body}
                          </p>
                          {insight.action && (
                            <div className="inline-flex items-center gap-2 mt-4 text-brass group cursor-pointer hover:text-charcoal transition-colors">
                              <p className="font-outfit text-[11px] uppercase tracking-wider font-bold italic">
                                {insight.action}
                              </p>
                              <ChevronRight size={12} className="group-hover:translate-x-1 transition-transform" />
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <motion.div 
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-10 bg-stone/5 rounded-[24px] border border-dashed border-stone/20"
                >
                  <p className="font-outfit text-[13px] text-[#6B6560] italic">
                    Building insights based on your shared activity...
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </Section>

          {/* Section 7: Weekly Summary */}
          {(weeklySummary || loadingSummary) && isSunday(new Date()) && (
            <Section delay={0.48} className="pb-12">
              <Card className="p-7 relative overflow-hidden bg-gradient-to-br from-brass/5 to-parchment/30 border-white/60 rounded-[32px]">
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-brass/5 rounded-full blur-[60px]" />
                
                <button 
                  onClick={handleDismissSummary}
                  className="absolute top-5 right-5 p-2 text-warm-grey/60 hover:text-charcoal transition-colors z-10 hover:bg-white/40 rounded-full"
                >
                  <X size={16} />
                </button>

                <div className="flex items-center justify-between mb-8">
                  <div>
                    <p className="font-outfit text-[10px] tracking-[3px] uppercase text-brass font-black mb-1">Weekly Digest</p>
                    <p className="font-serif text-[18px] text-charcoal italic">
                      {weeklySummary ? `${format(weeklySummary.weekStart.toDate(), "MMM d")} — ${format(weeklySummary.weekEnd.toDate(), "MMM d")}` : "..."}
                    </p>
                  </div>
                </div>

                {loadingSummary ? (
                  <div className="space-y-6">
                    <div className="flex gap-3">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="h-9 w-24 bg-white/40 rounded-full animate-pulse flex-shrink-0" />
                      ))}
                    </div>
                    <div className="space-y-3">
                      <div className="h-4 bg-charcoal/5 rounded-full w-full animate-pulse" />
                      <div className="h-4 bg-charcoal/5 rounded-full w-4/6 animate-pulse" />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-3 overflow-x-auto pb-4 no-scrollbar snap-x">
                      {[
                        { icon: "💰", val: `$${weeklySummary?.stats.spent.toFixed(0)}`, label: "Spent" },
                        { icon: "✅", val: Object.values(weeklySummary?.stats.choresCompleted || {}).reduce((a, b) => a + b, 0), label: "Chores" },
                        { icon: "📸", val: weeklySummary?.stats.memoriesCount, label: "Memories" },
                        { icon: "🛒", val: weeklySummary?.stats.groceriesCompleted, label: "Items" }
                      ].map((stat, i) => (
                        <motion.div 
                          key={i}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.5 + (i * 0.1) }}
                          className="bg-white/60 px-5 py-2.5 rounded-2xl flex flex-col items-center gap-0.5 flex-shrink-0 snap-start shadow-sm border border-white/80"
                        >
                          <span className="text-xl mb-1">{stat.icon}</span>
                          <span className="font-serif text-[16px] text-charcoal font-bold">{stat.val}</span>
                          <span className="font-outfit text-[9px] uppercase tracking-tighter text-warm-grey font-bold">{stat.label}</span>
                        </motion.div>
                      ))}
                    </div>

                    <p className="font-serif italic text-[18px] text-charcoal/90 leading-relaxed mt-4 bg-white/30 p-5 rounded-2xl border border-white/30">
                      {weeklySummary?.narrative || "Start using OurSpace this week and we'll write your first weekly story on Sunday"}
                    </p>
                  </>
                )}
              </Card>
          </Section>
        )}
      </div>
      {/* Gift Suggestions Sheet */}
      <BottomSheet 
        isOpen={!!selectedDateForGifts} 
        onClose={() => setSelectedDateForGifts(null)}
        title={`${selectedDateForGifts?.name} Gift Ideas`}
      >
        <div className="space-y-4 pb-8">
          {loadingGifts ? (
            <div className="flex flex-col items-center py-12 space-y-4">
              <div className="w-8 h-8 border-2 border-brass border-t-transparent rounded-full animate-spin" />
              <p className="font-outfit text-sm text-warm-grey italic">Gemini is finding thoughtful ideas...</p>
            </div>
          ) : (
            giftSuggestions.map((gift, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="bg-parchment border border-stone rounded-[20px] p-5 flex gap-4"
              >
                <span className="text-3xl flex-shrink-0">{gift.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="font-serif text-[16px] text-charcoal leading-tight">{gift.name}</h3>
                    <div className="bg-brass/10 px-2 py-0.5 rounded-full">
                      <span className="font-outfit text-[10px] text-brass font-bold uppercase">{gift.estimatedCost}</span>
                    </div>
                  </div>
                  <p className="font-outfit text-[13px] text-warm-grey leading-relaxed">
                    {gift.description}
                  </p>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </BottomSheet>

      {/* Birthday Animation Overlay */}
      {isPartnerBirthday && (
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
          {[...Array(15)].map((_, i) => (
            <motion.div
              key={i}
              initial={{ y: "110vh", x: `${Math.random() * 100}vw`, opacity: 0 }}
              animate={{ 
                y: "-10vh", 
                opacity: [0, 0.4, 0],
                x: `${Math.random() * 100}vw`
              }}
              transition={{ 
                duration: 10 + Math.random() * 10, 
                repeat: Infinity, 
                delay: Math.random() * 10,
                ease: "linear"
              }}
              className="absolute w-2 h-2 rounded-full bg-brass/30 blur-sm"
            />
          ))}
        </div>
      )}
    </div>
  );
}
