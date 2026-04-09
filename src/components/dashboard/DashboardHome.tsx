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

const Section = ({ children, delay = 0, className = "" }: { children: React.ReactNode, delay?: number, className?: string }) => (
  <motion.section 
    {...fadeUp(delay)}
    className={`w-full px-5 ${className}`}
  >
    {children}
  </motion.section>
);

const Card = ({ children, onClick, className = "" }: { children: React.ReactNode, onClick?: () => void, className?: string }) => (
  <motion.div
    whileHover={onClick ? cardHover : undefined}
    whileTap={onClick ? cardTap : undefined}
    onClick={onClick}
    className={`bg-parchment border border-stone rounded-[20px] overflow-hidden ${onClick ? 'cursor-pointer' : ''} ${className}`}
  >
    {children}
  </motion.div>
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
  const [startY, setStartY] = useState(0);

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
        setUserData(snapshot.data());
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
                setPartnerData(pSnap.data() as PartnerData);
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
        (snap) => setNextEvent(snap.docs[0]?.data() as EventData),
        (err) => handleError(err, OperationType.LIST, eventsPath)
      );

      // 4. Grocery Count
      const groceriesPath = `${householdPath}/groceries`;
      unsubGroceries = onSnapshot(
        query(
          collection(db, "households", userData.householdId, "groceries"),
          where("completed", "==", false)
        ),
        (snap) => setGroceryCount(snap.size),
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
          setMonthlySpend(total);
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
        (snap) => setLastMemory(snap.docs[0]?.data() as MemoryData),
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
        (snap) => setLastNote(snap.docs[0]?.data() as NoteData),
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
        if (summary.dismissedAt) {
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
  const handleTouchStart = (e: React.TouchEvent) => {
    const container = e.currentTarget as HTMLDivElement;
    if (container.scrollTop === 0) {
      setStartY(e.touches[0].pageY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (startY === 0) return;
    const y = e.touches[0].pageY;
    const dist = y - startY;
    if (dist > 70 && !isRefreshing) {
      setIsRefreshing(true);
      fetchInsights(true).then(() => {
        setIsRefreshing(false);
        setStartY(0);
      });
    }
  };

  const handleTouchEnd = () => {
    setStartY(0);
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
        height: 'calc(100dvh - 80px)',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
        paddingBottom: 'calc(32px + env(safe-area-inset-bottom))',
        background: '#F8F4EE'
      }}
      className="no-scrollbar"
    >
      {/* Section 1: Time-aware Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={() => onNavigate('calendar')}
        style={{ background: timeConfig.bg }}
        className="w-full pt-20 pb-12 px-8 transition-colors duration-1000 cursor-pointer"
      >
        <div className="space-y-1">
          <h1 
            className="font-serif text-[48px] font-light leading-tight"
            style={{ color: timeConfig.dark ? "#F8F4EE" : "#1A1A1A" }}
          >
            {timeConfig.greeting}
          </h1>
          <p 
            className="font-outfit text-lg"
            style={{ color: timeConfig.dark ? "#D4CEC4" : "#6B6560" }}
          >
            {userData?.displayName?.split(' ')[0] || "there"}
          </p>
        </div>
        <div className="mt-8">
          <p 
            className="font-outfit text-[13px] uppercase tracking-[2px] font-medium"
            style={{ color: timeConfig.dark ? "#B8955A" : "#B8955A" }}
          >
            {format(currentTime, "EEEE, d MMMM")}
          </p>
        </div>
      </motion.header>

      <div className="space-y-8 mt-8">
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
                  className={`flex-shrink-0 w-[220px] bg-parchment border border-stone rounded-[20px] p-5 snap-start cursor-pointer relative overflow-hidden ${
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
                className="bg-parchment border border-stone rounded-[24px] p-6 shadow-sm"
              >
                <p className="font-outfit text-[13px] text-warm-grey mb-4">How are you feeling today?</p>
                <div className="flex justify-between items-center">
                  {MOOD_EMOJIS.map((emoji, i) => (
                    <button
                      key={i}
                      onClick={() => handleMoodCheckIn(i)}
                      className="w-11 h-11 flex items-center justify-center text-2xl hover:bg-linen rounded-full transition-colors active:scale-90"
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
                <div className="bg-parchment border border-stone rounded-full px-[14px] py-[6px] flex items-center gap-3 shadow-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg">{MOOD_EMOJIS[myMood.mood - 1]}</span>
                    {partnerMood ? (
                      <span className="text-lg">{MOOD_EMOJIS[partnerMood.mood - 1]}</span>
                    ) : (
                      <div className="w-5 h-5 rounded-full border border-stone border-dashed flex items-center justify-center">
                        <Heart size={10} className="text-stone" />
                      </div>
                    )}
                  </div>
                  <span className="font-outfit text-[12px] text-warm-grey">
                    {partnerMood ? "Today's vibes" : "Waiting for partner..."}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>

        {/* Section 2: Partner Status Card */}
        <Section delay={0.08}>
          <Card className="p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <img 
                  src={partnerData?.photoURL || `https://ui-avatars.com/api/?name=${partnerData?.displayName || 'P'}&background=EDE8DF&color=1A1A1A`}
                  alt=""
                  className="w-12 h-12 rounded-full object-cover border border-stone"
                  referrerPolicy="no-referrer"
                />
                <div 
                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-parchment ${partnerData?.isOnline ? 'bg-green-500' : 'bg-stone'}`}
                />
              </div>
              <div>
                <h2 className="font-serif text-xl text-charcoal">
                  {partnerData?.displayName || "Partner"}
                </h2>
                <p className="font-outfit text-xs text-warm-grey">
                  {partnerData?.isOnline ? "Online now" : lastSeenText}
                </p>
              </div>
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

        {/* Section 3: Bento Summary Grid */}
        <Section delay={0.16}>
          <div className="grid grid-cols-12 gap-4 h-[200px]">
            {/* Large card left: Next Event */}
            <Card 
              onClick={() => onNavigate('calendar')}
              className="col-span-7 p-5 flex flex-col justify-between cursor-pointer hover:bg-[#EDE8DF] transition-colors"
            >
              <p className="font-outfit text-[11px] uppercase tracking-wider text-warm-grey">Next Event</p>
              {nextEvent ? (
                <div className="space-y-1">
                  <h3 className="font-serif text-lg text-charcoal line-clamp-2">{nextEvent.title}</h3>
                  <p className="font-outfit text-[13px] text-brass">
                    {ensureDate(nextEvent.date) ? format(ensureDate(nextEvent.date)!, "h:mm a") : ""}
                  </p>
                </div>
              ) : (
                <EmptyState text="Nothing yet" />
              )}
            </Card>

            <div className="col-span-5 flex flex-col gap-4">
              {/* Small card top right: Groceries */}
              <Card 
                onClick={() => onNavigate('grocery')}
                className="flex-1 p-4 flex flex-col justify-center items-center text-center cursor-pointer hover:bg-[#EDE8DF] transition-colors"
              >
                <span className="font-serif text-3xl text-charcoal">{groceryCount}</span>
                <span className="font-outfit text-[12px] text-warm-grey">items left</span>
              </Card>
              {/* Small card bottom right: Spend */}
              <Card 
                onClick={() => onNavigate('finances')}
                className="flex-1 p-4 flex flex-col justify-center items-center text-center cursor-pointer hover:bg-[#EDE8DF] transition-colors"
              >
                <span className="font-serif text-2xl text-charcoal">${monthlySpend}</span>
                <span className="font-outfit text-[12px] text-warm-grey">this month</span>
              </Card>
            </div>
          </div>
        </Section>

        {/* Section 4: Last Memory */}
        <Section delay={0.24}>
          <Card onClick={() => onNavigate('together')} className="group cursor-pointer">
            <div className="aspect-[16/6] w-full relative bg-stone overflow-hidden">
              {lastMemory ? (
                <img 
                  src={lastMemory.imageUrl} 
                  alt="" 
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-stone/20">
                  <EmptyState text="Add your first memory together" />
                </div>
              )}
            </div>
            {lastMemory && (
              <div className="p-4">
                <p className="font-outfit text-sm text-warm-grey line-clamp-1 italic">
                  "{lastMemory.caption}"
                </p>
              </div>
            )}
          </Card>
        </Section>

        {/* Section 5: Partner's Last Note */}
        <Section delay={0.32}>
          <Card className="p-8 relative min-h-[160px] flex flex-col justify-center">
            <span className="absolute top-4 left-4 font-serif text-[80px] text-brass-light leading-none select-none opacity-50">
              “
            </span>
            <div className="relative z-10 space-y-4">
              {lastNote ? (
                <>
                  <p className="font-serif italic text-lg text-charcoal leading-relaxed">
                    {lastNote.text}
                  </p>
                  <p className="font-outfit text-[13px] text-brass">
                    — {lastNote.authorName || partnerData?.displayName || "Partner"}
                  </p>
                </>
              ) : (
                <EmptyState text="Nothing yet — send something" />
              )}
            </div>
          </Card>
        </Section>

        {/* Section 6: Relationship Insights */}
        <Section delay={0.4} className="pb-12">
          <div className="mb-4">
            <p className="font-outfit text-[11px] tracking-[2px] uppercase text-brass font-medium">
              Relationship Insights
            </p>
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
                  <div key={i} className="bg-[#EDE8DF] border border-[#D4CEC4] rounded-[20px] p-5 animate-pulse">
                    <div className="flex gap-4">
                      <div className="w-10 h-10 bg-[#D4CEC4] rounded-full" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-[#D4CEC4] rounded w-1/3" />
                        <div className="h-3 bg-[#D4CEC4] rounded w-full" />
                        <div className="h-3 bg-[#D4CEC4] rounded w-2/3" />
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
                  <div 
                    key={i} 
                    className="bg-[#EDE8DF] border border-[#D4CEC4] rounded-[20px] p-5 shadow-sm"
                  >
                    <div className="flex items-start gap-4">
                      <span className="text-2xl flex-shrink-0">{insight.emoji}</span>
                      <div className="space-y-1.5">
                        <h3 className="font-serif text-[17px] text-[#1A1A1A] leading-tight font-bold">
                          {insight.title}
                        </h3>
                        <p className="font-outfit text-[13px] text-[#6B6560] leading-[1.5]">
                          {insight.body}
                        </p>
                        {insight.action && (
                          <p className="font-outfit text-[12px] text-brass italic mt-2">
                            {insight.action}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </motion.div>
            ) : (
              <motion.div 
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-8"
              >
                <p className="font-outfit text-sm text-[#6B6560] italic">
                  Use the app for a few days and we'll surface insights about your life together
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </Section>

        {/* Section 7: Weekly Summary */}
        {(weeklySummary || loadingSummary) && isSunday(new Date()) && (
          <Section delay={0.48} className="pb-12">
            <Card className="p-6 relative overflow-hidden bg-[#EDE8DF] border-[#D4CEC4] rounded-[24px]">
              <button 
                onClick={handleDismissSummary}
                className="absolute top-4 right-4 p-2 text-warm-grey hover:text-charcoal transition-colors z-10"
              >
                <X size={18} />
              </button>

              <div className="flex items-center justify-between mb-6">
                <p className="font-outfit text-[11px] tracking-[2px] uppercase text-brass font-medium">
                  This Week
                </p>
                <p className="font-outfit text-[11px] text-warm-grey">
                  {weeklySummary ? `${format(weeklySummary.weekStart.toDate(), "MMM d")} - ${format(weeklySummary.weekEnd.toDate(), "MMM d")}` : "..."}
                </p>
              </div>

              {loadingSummary ? (
                <div className="space-y-6">
                  <div className="flex gap-3 overflow-x-auto no-scrollbar">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-8 w-24 bg-white/50 rounded-full animate-pulse flex-shrink-0" />
                    ))}
                  </div>
                  <div className="space-y-2">
                    <div className="h-4 bg-charcoal/5 rounded w-full animate-pulse" />
                    <div className="h-4 bg-charcoal/5 rounded w-5/6 animate-pulse" />
                    <div className="h-4 bg-charcoal/5 rounded w-4/6 animate-pulse" />
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar snap-x">
                    <div className="bg-white px-4 py-1.5 rounded-full flex items-center gap-2 flex-shrink-0 snap-start shadow-sm">
                      <span className="text-sm">💰</span>
                      <span className="font-outfit text-[13px] text-charcoal font-medium">${weeklySummary?.stats.spent.toFixed(0)}</span>
                    </div>
                    <div className="bg-white px-4 py-1.5 rounded-full flex items-center gap-2 flex-shrink-0 snap-start shadow-sm">
                      <span className="text-sm">✅</span>
                      <span className="font-outfit text-[13px] text-charcoal font-medium">
                        {Object.values(weeklySummary?.stats.choresCompleted || {}).reduce((a, b) => a + b, 0)} chores
                      </span>
                    </div>
                    <div className="bg-white px-4 py-1.5 rounded-full flex items-center gap-2 flex-shrink-0 snap-start shadow-sm">
                      <span className="text-sm">📸</span>
                      <span className="font-outfit text-[13px] text-charcoal font-medium">{weeklySummary?.stats.memoriesCount} memories</span>
                    </div>
                    <div className="bg-white px-4 py-1.5 rounded-full flex items-center gap-2 flex-shrink-0 snap-start shadow-sm">
                      <span className="text-sm">🛒</span>
                      <span className="font-outfit text-[13px] text-charcoal font-medium">{weeklySummary?.stats.groceriesCompleted} items</span>
                    </div>
                  </div>

                  <p className="font-serif italic text-[16px] text-charcoal leading-relaxed mt-6">
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
