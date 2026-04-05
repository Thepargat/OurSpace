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
  Timestamp 
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../AuthWrapper";
import { format, isSameMonth } from "date-fns";

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
export default function DashboardHome() {
  const { user } = useAuth();
  const [userData, setUserData] = useState<any>(null);
  const [partnerData, setPartnerData] = useState<PartnerData | null>(null);
  const [nextEvent, setNextEvent] = useState<EventData | null>(null);
  const [groceryCount, setGroceryCount] = useState(0);
  const [monthlySpend, setMonthlySpend] = useState(0);
  const [lastMemory, setLastMemory] = useState<MemoryData | null>(null);
  const [lastNote, setLastNote] = useState<NoteData | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

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
    let unsubPartner: () => void;
    if (userData?.householdId) {
      const householdPath = `households/${userData.householdId}`;
      const unsubHousehold = onSnapshot(doc(db, "households", userData.householdId), 
        (snapshot) => {
          const hData = snapshot.data();
          const partnerId = hData?.memberIds?.find((id: string) => id !== user.uid);
          
          if (partnerId) {
            const partnerPath = `users/${partnerId}`;
            unsubPartner = onSnapshot(doc(db, "users", partnerId), 
              (pSnap) => {
                setPartnerData(pSnap.data() as PartnerData);
              },
              (err) => handleError(err, OperationType.GET, partnerPath)
            );
          }
        },
        (err) => handleError(err, OperationType.GET, householdPath)
      );
      
      // 3. Next Event
      const eventsPath = `${householdPath}/events`;
      const unsubEvent = onSnapshot(
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
      const unsubGroceries = onSnapshot(
        query(
          collection(db, "households", userData.householdId, "groceries"),
          where("completed", "==", false)
        ),
        (snap) => setGroceryCount(snap.size),
        (err) => handleError(err, OperationType.LIST, groceriesPath)
      );

      // 5. Monthly Spend
      const expensesPath = `${householdPath}/expenses`;
      const unsubExpenses = onSnapshot(
        collection(db, "households", userData.householdId, "expenses"),
        (snap) => {
          const total = snap.docs
            .map(d => d.data())
            .filter(d => isSameMonth(d.date.toDate(), new Date()))
            .reduce((acc, curr) => acc + (curr.amount || 0), 0);
          setMonthlySpend(total);
        },
        (err) => handleError(err, OperationType.LIST, expensesPath)
      );

      // 6. Last Memory
      const memoriesPath = `${householdPath}/memories`;
      const unsubMemory = onSnapshot(
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
      const unsubNote = onSnapshot(
        query(
          collection(db, "households", userData.householdId, "notes"),
          orderBy("createdAt", "desc"),
          limit(1)
        ),
        (snap) => setLastNote(snap.docs[0]?.data() as NoteData),
        (err) => handleError(err, OperationType.LIST, notesPath)
      );

      return () => {
        unsubUser();
        unsubHousehold();
        unsubPartner?.();
        unsubEvent();
        unsubGroceries();
        unsubExpenses();
        unsubMemory();
        unsubNote();
      };
    }

    return () => unsubUser();
  }, [user, userData?.householdId]);

  const lastSeenText = useMemo(() => {
    if (!partnerData?.lastSeen) return "";
    const diff = Math.floor((Date.now() - partnerData.lastSeen.toMillis()) / 60000);
    if (diff < 1) return "Just now";
    if (diff < 60) return `Last seen ${diff}m ago`;
    return `Last seen ${Math.floor(diff/60)}h ago`;
  }, [partnerData]);

  return (
    <div 
      style={{
        height: '100dvh',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
        paddingBottom: 'calc(100px + env(safe-area-inset-bottom))'
      }}
      className="bg-linen"
    >
      {/* Section 1: Time-aware Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        style={{ background: timeConfig.bg }}
        className="w-full pt-20 pb-12 px-8 transition-colors duration-1000"
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

        {/* Section 3: Bento Summary Grid */}
        <Section delay={0.16}>
          <div className="grid grid-cols-12 gap-4 h-[200px]">
            {/* Large card left: Next Event */}
            <Card className="col-span-7 p-5 flex flex-col justify-between">
              <p className="font-outfit text-[11px] uppercase tracking-wider text-warm-grey">Next Event</p>
              {nextEvent ? (
                <div className="space-y-1">
                  <h3 className="font-serif text-lg text-charcoal line-clamp-2">{nextEvent.title}</h3>
                  <p className="font-outfit text-[13px] text-brass">{format(nextEvent.date.toDate(), "h:mm a")}</p>
                </div>
              ) : (
                <EmptyState text="Nothing yet" />
              )}
            </Card>

            <div className="col-span-5 flex flex-col gap-4">
              {/* Small card top right: Groceries */}
              <Card className="flex-1 p-4 flex flex-col justify-center items-center text-center">
                <span className="font-serif text-3xl text-charcoal">{groceryCount}</span>
                <span className="font-outfit text-[12px] text-warm-grey">items left</span>
              </Card>
              {/* Small card bottom right: Spend */}
              <Card className="flex-1 p-4 flex flex-col justify-center items-center text-center">
                <span className="font-serif text-2xl text-charcoal">${monthlySpend}</span>
                <span className="font-outfit text-[12px] text-warm-grey">this month</span>
              </Card>
            </div>
          </div>
        </Section>

        {/* Section 4: Last Memory */}
        <Section delay={0.24}>
          <Card onClick={() => {}} className="group">
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
      </div>
    </div>
  );
}
