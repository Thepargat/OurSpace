import { useState, useEffect, useRef, useMemo } from "react";
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  animate,
  useReducedMotion,
} from "motion/react";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../AuthWrapper";
import { differenceInDays, differenceInMinutes, format } from "date-fns";
import { startProactiveBrain } from "../../services/proactiveBrain";
import { getOrUpdateInsights, Insight } from "../../services/relationshipIntelligence";
import { cn } from "../../lib/utils";

const GOLD = "#B8955A";
const GOLD_RGB = "184, 149, 90";
const HEART_RED = "#FF0000";
const HEART_RED_GLOW = "rgba(255, 0, 0, 0.45)";

// ─── Greeting helper ────────────────────────────────────────────────────────────
function getGreeting(name: string) {
  const h = new Date().getHours();
  const first = name?.split(" ")[0] || "there";
  if (h < 5)  return `Still up, ${first}?`;
  if (h < 12) return `Good morning, ${first}`;
  if (h < 17) return `Good afternoon, ${first}`;
  if (h < 21) return `Good evening, ${first}`;
  return `Good night, ${first} 🌙`;
}

// ─── Count-up Number Animator ────────────────────────────────────────────────
function CountUp({ end, duration = 2 }: { end: number; duration?: number }) {
  const [count, setCount] = useState(0);
  const prefersReduced = useReducedMotion();
  useEffect(() => {
    if (end === 0) { setCount(0); return; }
    if (prefersReduced) { setCount(end); return; }
    const controls = animate(0, end, {
      duration,
      ease: [0.16, 1, 0.3, 1] as any,
      onUpdate: (v) => setCount(Math.floor(v)),
    });
    return () => controls.stop();
  }, [end, duration, prefersReduced]);
  return <>{count.toLocaleString()}</>;
}

// ─── Skeleton shimmer ────────────────────────────────────────────────────────
function Shimmer({ className = "" }: { className?: string }) {
  return (
    <motion.div
      className={`rounded-xl bg-gradient-to-r from-[#EDE8DF] via-[#f8f4ee] to-[#EDE8DF] bg-[length:200%_100%] ${className}`}
      animate={{ backgroundPosition: ["200% 0", "-200% 0"] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
    />
  );
}

// ─── Ambient floating orbs (decorative background) ──────────────────────────
function AmbientOrbs({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {[
        { size: 180, x: "10%", y: "15%", delay: 0 },
        { size: 120, x: "70%", y: "30%", delay: 0.8 },
        { size: 90,  x: "50%", y: "70%", delay: 1.5 },
      ].map((orb, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: orb.size,
            height: orb.size,
            left: orb.x,
            top: orb.y,
            background: `radial-gradient(circle, rgba(${GOLD_RGB}, 0.12) 0%, transparent 70%)`,
            transform: "translate(-50%, -50%)",
          }}
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.4, 0.7, 0.4],
          }}
          transition={{
            duration: 5 + i,
            repeat: Infinity,
            delay: orb.delay,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

// ─── Intelligent Heartbeat Hook ──────────────────────────────────────────────
function useHeartbeatState(
  partnerIsOnline: boolean,
  partnerLastOnlineAt: string | null
) {
  const bothOnline = partnerIsOnline;
  const [justReunited, setJustReunited] = useState(false);
  const [celebrationDone, setCelebrationDone] = useState(false);
  const prevBothOnline = useRef(false);

  useEffect(() => {
    if (bothOnline && !prevBothOnline.current && !celebrationDone) {
      setJustReunited(true);
      setCelebrationDone(true);
      const t = setTimeout(() => setJustReunited(false), 5000);
      return () => clearTimeout(t);
    }
    if (!bothOnline) setCelebrationDone(false);
    prevBothOnline.current = bothOnline;
  }, [bothOnline]);

  const { opacity, speed, color } = useMemo(() => {
    if (bothOnline) return { opacity: 1, speed: 1.3, color: HEART_RED };
    if (!partnerIsOnline && partnerLastOnlineAt) {
      const mins = differenceInMinutes(new Date(), new Date(partnerLastOnlineAt));
      const fade = Math.max(0.12, 1 - mins / 60);
      const slow = Math.max(4, 1.4 + mins / 12);
      return { opacity: fade, speed: slow, color: `rgba(${GOLD_RGB}, ${fade})` };
    }
    return { opacity: 0.12, speed: 6, color: `rgba(${GOLD_RGB}, 0.12)` };
  }, [bothOnline, partnerIsOnline, partnerLastOnlineAt]);

  return { bothOnline, justReunited, opacity, speed, color };
}

// ─── Animation variants ──────────────────────────────────────────────────────
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } },
};
const rise = {
  hidden: { opacity: 0, y: 28, scale: 0.96 },
  show:  { opacity: 1, y: 0, scale: 1, transition: { type: "spring" as const, stiffness: 260, damping: 22 } },
};
const cardHover = { y: -5, scale: 1.025, transition: { type: "spring" as const, stiffness: 380, damping: 20 } };
const cardTap   = { scale: 0.96, transition: { duration: 0.09 } };

// ─── Reunion Sparkles ────────────────────────────────────────────────────────
function ReunionBurst() {
  return (
    <>
      {/* Expanding rings — vivid red */}
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={`ring-${i}`}
          className="absolute inset-0 rounded-full border-2"
          style={{ borderColor: `${HEART_RED}80` }}
          initial={{ scale: 0.3, opacity: 0.9 }}
          animate={{ scale: 4 + i * 1.2, opacity: 0 }}
          transition={{ duration: 2, delay: i * 0.18, ease: "easeOut" }}
        />
      ))}
      {/* Sparks — red, white, pink */}
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i / 12) * Math.PI * 2;
        const dist  = 65 + Math.random() * 25;
        return (
          <motion.div
            key={`spark-${i}`}
            className="absolute w-2 h-2 rounded-full"
            style={{
              background: i % 3 === 0 ? HEART_RED : i % 3 === 1 ? "#fff" : "#ff6b6b",
              top: "50%", left: "50%",
              marginTop: -4, marginLeft: -4,
            }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x: Math.cos(angle) * dist,
              y: Math.sin(angle) * dist,
              opacity: 0, scale: 0,
            }}
            transition={{ duration: 1.2, delay: 0.1 + Math.random() * 0.15, ease: "easeOut" }}
          />
        );
      })}
    </>
  );
}

// ─── Heartbeat Section ───────────────────────────────────────────────────────
function HeartbeatSection({
  userData, partnerData, heart
}: {
  userData: any; partnerData: any; heart: ReturnType<typeof useHeartbeatState>;
}) {
  // Realistic lub-dub cardiac pattern
  const heartAnimation = heart.bothOnline
    ? {
        scale: [1, 1.18, 1.04, 1.15, 1, 1, 1, 1],
        filter: [
          `drop-shadow(0 0 5px ${HEART_RED_GLOW})`,
          `drop-shadow(0 0 18px ${HEART_RED_GLOW}) drop-shadow(0 0 6px ${HEART_RED})`,
          `drop-shadow(0 0 8px ${HEART_RED_GLOW})`,
          `drop-shadow(0 0 16px ${HEART_RED_GLOW}) drop-shadow(0 0 5px ${HEART_RED})`,
          `drop-shadow(0 0 5px ${HEART_RED_GLOW})`,
          `drop-shadow(0 0 5px ${HEART_RED_GLOW})`,
          `drop-shadow(0 0 5px ${HEART_RED_GLOW})`,
          `drop-shadow(0 0 5px ${HEART_RED_GLOW})`,
        ],
      }
    : {
        scale: [1, 1.05, 1, 1, 1, 1],
        filter: `drop-shadow(0 0 3px ${heart.color})`,
      };

  const heartTransition = {
    duration: heart.speed,
    repeat: Infinity,
    ease: "easeInOut" as const,
    times: heart.bothOnline ? [0, 0.08, 0.16, 0.24, 0.36, 0.55, 0.75, 1] : [0, 0.15, 0.35, 0.55, 0.75, 1],
  };

  // Ambient breathing ring — pulses gently behind the heart
  const ringAnimation = heart.bothOnline
    ? { scale: [1, 1.6, 1.2, 1.55, 1, 1], opacity: [0.25, 0.08, 0.18, 0.07, 0.18, 0.25] }
    : { scale: [1, 1.15, 1], opacity: [0.08, 0.03, 0.08] };
  const ringTransition = {
    duration: heart.speed,
    repeat: Infinity,
    ease: "easeInOut" as const,
    times: heart.bothOnline ? [0, 0.08, 0.16, 0.24, 0.36, 1] : [0, 0.4, 1],
  };

  const AvatarBubble = ({ data, isOnline, isSelf }: { data: any; isOnline: boolean; isSelf?: boolean }) => (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative">
        {/* Online glow ring */}
        {isOnline && (
          <motion.div
            className="absolute -inset-[3px] rounded-full"
            style={{ background: `conic-gradient(${GOLD}, #C47B6A, ${GOLD})` }}
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          />
        )}
        <div
          className="relative w-16 h-16 rounded-full overflow-hidden border-2 border-[#fcf9f4] shadow-lg"
          style={{ zIndex: 1 }}
        >
          {data?.photoURL
            ? <img src={data.photoURL} alt="" className="w-full h-full object-cover" />
            : (
              <div className="w-full h-full flex items-center justify-center font-serif text-xl"
                style={{ background: `${GOLD}1A`, color: GOLD }}>
                {data?.displayName?.[0] ?? "?"}
              </div>
            )
          }
        </div>
        {/* Status dot */}
        <div className={cn(
          "absolute bottom-0 right-0 w-4 h-4 border-2 border-[#fcf9f4] rounded-full z-10 shadow",
          isOnline ? "bg-green-400" : "bg-stone-300"
        )} />
      </div>
      <p className="text-[11px] font-medium text-[#1A1A1A] leading-none">
        {data?.displayName?.split(" ")[0] || (isSelf ? "You" : "Partner")}
      </p>
    </div>
  );

  return (
    <div className="flex items-center justify-center gap-6 py-2">
      <AvatarBubble data={userData} isOnline isSelf />

      {/* Central heart */}
      <div className="relative flex flex-col items-center w-20">
        <AnimatePresence>
          {heart.justReunited && <ReunionBurst />}
        </AnimatePresence>

        {/* Ambient breathing ring */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: heart.bothOnline
              ? `radial-gradient(circle, ${HEART_RED}30 0%, transparent 70%)`
              : `radial-gradient(circle, ${GOLD}18 0%, transparent 70%)`,
            width: 80, height: 80,
            margin: 'auto',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            position: 'absolute',
          }}
          animate={ringAnimation}
          transition={ringTransition}
        />

        <motion.div
          animate={heartAnimation}
          transition={heartTransition}
          style={{ opacity: heart.opacity }}
          className="cursor-default select-none relative z-10"
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 44,
              color: heart.bothOnline ? HEART_RED : heart.color,
              fontVariationSettings: "'FILL' 1",
              display: "block",
            }}
          >
            favorite
          </span>
        </motion.div>

        <AnimatePresence>
          {heart.justReunited && (
            <motion.p
              initial={{ opacity: 0, y: 8, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.9 }}
              className="font-serif italic text-[10px] tracking-wider whitespace-nowrap mt-1"
              style={{ color: HEART_RED }}
            >
              together again ♥
            </motion.p>
          )}
          {!heart.justReunited && !heart.bothOnline && partnerData && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="font-serif italic text-[10px] text-center leading-tight mt-0.5"
              style={{ color: `${GOLD}60` }}
            >
              {partnerData?.displayName?.split(" ")[0]} is away
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <AvatarBubble data={partnerData} isOnline={!!partnerData?.isOnline} />
    </div>
  );
}

// ─── DashboardHome ────────────────────────────────────────────────────────────
export default function DashboardHome({ onNavigate }: { onNavigate: (t: string) => void }) {
  const { user, householdId, userData } = useAuth();
  const [partnerData, setPartnerData] = useState<any>(null);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [lastMemory, setLastMemory] = useState<any>(null);
  const [firstMemory, setFirstMemory] = useState<any>(null);
  const [milestones, setMilestones] = useState({ met: 0, married: 0 });
  const [streak, setStreak] = useState(0);
  const [daysToAnniversary, setDaysToAnniversary] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [pulseData, setPulseData] = useState({
    birthday: { name: "", days: 0 },
    chores: { count: 0 },
    goal: { name: "", progress: 0 },
    event: { title: "" },
    grocery: { count: 0 },
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: containerRef });
  const heroScale      = useTransform(scrollY, [0, 200], [1, 1.08]);
  const heroOpacity    = useTransform(scrollY, [0, 180], [1, 0.5]);
  const navBg          = useTransform(scrollY, [0, 80],  ["rgba(252,249,244,0)", "rgba(252,249,244,0.95)"]);

  // ── Firestore ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!householdId || !user) return;

    // Helper: safely parse any date format to a JS Date
    const toDate = (val: any): Date | null => {
      if (!val) return null;
      if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
      if (typeof val.toDate === 'function') return val.toDate();
      if (typeof val === 'object' && val.seconds !== undefined) return new Date(val.seconds * 1000);
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    };

    const unsubHousehold = onSnapshot(doc(db, "households", householdId), (snap) => {
      const hData = snap.data();
      const pId = hData?.memberIds?.find((id: string) => id !== user.uid);
      if (pId) setPartnerId(pId);

      // ── Days Together ── use meetDate > anniversary > household creation
      const meetDate =
        toDate(userData?.meetDate) ||
        toDate(userData?.anniversary) ||
        toDate(hData?.meetDate) ||
        toDate(hData?.createdAt);
      if (meetDate) {
        setMilestones((m) => ({ ...m, met: Math.max(0, differenceInDays(new Date(), meetDate)) }));
      }

      // ── Days Married ── user's own doc first ('anniversary' OR 'anniversaryDate'), then household
      const marriageDate =
        toDate(userData?.anniversary) ||        // Settings saves this field
        toDate(userData?.anniversaryDate) ||    // legacy
        toDate(userData?.weddingDate) ||
        toDate(hData?.anniversaryDate);
      if (marriageDate) {
        setMilestones((m) => ({ ...m, married: Math.max(0, differenceInDays(new Date(), marriageDate)) }));
        // Days to next anniversary
        const today = new Date();
        const next = new Date(today.getFullYear(), marriageDate.getMonth(), marriageDate.getDate());
        if (next < today) next.setFullYear(today.getFullYear() + 1);
        setDaysToAnniversary(differenceInDays(next, today));
      }

      if (pId) {
        onSnapshot(doc(db, "users", pId), (pSnap) => {
          const pData = pSnap.data();
          setPartnerData({ ...pData, uid: pId });

          // Birthday countdown for partner
          if (pData?.birthday) {
            const bday = toDate(pData.birthday);
            if (bday) {
              const today = new Date();
              const next = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
              if (next < today) next.setFullYear(today.getFullYear() + 1);
              const days = differenceInDays(next, today);
              setPulseData((p) => ({
                ...p,
                birthday: { name: pData.displayName || "Partner", days },
              }));
            }
          }

          // Marriage date from partner as fallback
          if (!userData?.anniversaryDate && !userData?.weddingDate && pData?.anniversaryDate) {
            const mDate = toDate(pData.anniversaryDate);
            if (mDate) {
              setMilestones((m) => ({ ...m, married: Math.max(0, differenceInDays(new Date(), mDate)) }));
            }
          }
        });
      }
      setLoaded(true);
    });

    const unsubMemory = onSnapshot(
      query(collection(db, "households", householdId, "memories"), orderBy("date", "desc"), limit(1)),
      (snap) => { if (snap.docs[0]) setLastMemory(snap.docs[0].data()); }
    );

    // First memory ever — for anniversary card
    const unsubFirstMemory = onSnapshot(
      query(collection(db, "households", householdId, "memories"), orderBy("date", "asc"), limit(1)),
      (snap) => { if (snap.docs[0]) setFirstMemory(snap.docs[0].data()); }
    );

    // Relationship streak — consecutive days either user was active in app
    // We use completed chores + completed groceries as activity signals (pure DB)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const unsubStreakChores = onSnapshot(
      query(
        collection(db, "households", householdId, "chores"),
        where("completed", "==", true),
        orderBy("completedAt", "desc")
      ),
      (choreSnap) => {
        const activeDays = new Set<string>();
        choreSnap.docs.forEach(d => {
          const raw = d.data().completedAt;
          const dt = raw?.toDate ? raw.toDate() : raw ? new Date(raw) : null;
          if (dt && dt >= thirtyDaysAgo) activeDays.add(dt.toISOString().slice(0, 10));
        });
        // Calculate consecutive streak back from today
        let count = 0;
        const today = new Date();
        for (let i = 0; i < 30; i++) {
          const d = new Date(today);
          d.setDate(today.getDate() - i);
          if (activeDays.has(d.toISOString().slice(0, 10))) count++;
          else if (i > 0) break;
        }
        setStreak(count);
      }
    );

    const unsubChores = onSnapshot(
      query(collection(db, "households", householdId, "chores"), where("completed", "==", false)),
      (snap) => setPulseData((p) => ({ ...p, chores: { count: snap.size } }))
    );

    const unsubGrocery = onSnapshot(
      query(collection(db, "households", householdId, "groceries"), where("completed", "==", false)),
      (snap) => setPulseData((p) => ({ ...p, grocery: { count: snap.size } }))
    );

    const unsubGoals = onSnapshot(
      query(collection(db, "households", householdId, "savingsGoals"), orderBy("currentAmount", "desc"), limit(1)),
      (snap) => {
        const g = snap.docs[0]?.data();
        if (g) setPulseData((p) => ({
          ...p,
          goal: {
            name: g.title,
            progress: g.targetAmount > 0 ? Math.min(100, (g.currentAmount / g.targetAmount) * 100) : 0,
          },
        }));
      }
    );

    // Events use startTime ISO string field (not 'date')
    const nowISO = new Date().toISOString();
    const unsubEvent = onSnapshot(
      query(
        collection(db, "households", householdId, "events"),
        where("startTime", ">=", nowISO),
        orderBy("startTime", "asc"),
        limit(1)
      ),
      (snap) => setPulseData((p) => ({ ...p, event: { title: snap.docs[0]?.data()?.title || "Nothing planned" } }))
    );

    return () => { unsubHousehold(); unsubMemory(); unsubFirstMemory(); unsubChores(); unsubGoals(); unsubGrocery(); unsubEvent(); unsubStreakChores(); };
  }, [householdId, user?.uid, userData]);

  // ── Proactive Brain ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!householdId || !user || !partnerId) return;
    const stop = startProactiveBrain(householdId, user.uid, partnerId);
    return () => stop();
  }, [householdId, user?.uid, partnerId]);

  // ── Relationship Intelligence (AI Insights) ──────────────────────────────
  useEffect(() => {
    if (!householdId || !user || !partnerId || !userData || !partnerData) return;
    const userName = userData.displayName?.split(' ')[0] || 'You';
    const partnerName = partnerData.displayName?.split(' ')[0] || 'Partner';
    getOrUpdateInsights(householdId, user.uid, partnerId, userName, partnerName)
      .then((result) => { if (result) setInsights(result); })
      .catch(() => {});
  }, [householdId, user?.uid, partnerId]);

  const heart = useHeartbeatState(!!partnerData?.isOnline, partnerData?.lastOnlineAt || null);

  // Pulse card configs — all fixed calculations
  const pulseCards = useMemo(() => [
    {
      icon: "cake", label: "Birthday", accent: "#E17B9B",
      body: pulseData.birthday.name && pulseData.birthday.days >= 0
        ? pulseData.birthday.days === 0
          ? `🎂 It's ${pulseData.birthday.name.split(' ')[0]}'s birthday today!`
          : `${pulseData.birthday.name.split(' ')[0]}'s birthday in ${pulseData.birthday.days}d`
        : "No birthday upcoming",
      badge: pulseData.birthday.days > 0 && pulseData.birthday.days <= 30 ? `${pulseData.birthday.days}d` : null,
      onClick: () => onNavigate("together"),
    },
    {
      icon: "task_alt", label: "Chores", accent: "#5B68E8",
      body: pulseData.chores.count > 0
        ? `${pulseData.chores.count} task${pulseData.chores.count > 1 ? 's' : ''} to do`
        : "All caught up ✓",
      badge: pulseData.chores.count > 0 ? `${pulseData.chores.count}` : null,
      onClick: () => onNavigate("chores"),
    },
    {
      icon: "savings", label: "Savings", accent: GOLD,
      body: pulseData.goal.name || "Set a shared goal",
      badge: pulseData.goal.progress > 0 ? `${Math.round(pulseData.goal.progress)}%` : null,
      progress: pulseData.goal.progress,
      onClick: () => onNavigate("finances"),
    },
    {
      icon: "shopping_cart", label: "Grocery", accent: "#3BAA7C",
      body: pulseData.grocery.count > 0
        ? `${pulseData.grocery.count} item${pulseData.grocery.count > 1 ? 's' : ''} left to buy`
        : "Grocery list is clear",
      badge: pulseData.grocery.count > 0 ? `${pulseData.grocery.count}` : null,
      onClick: () => onNavigate("grocery"),
    },
  ], [pulseData, onNavigate]);

  const quickActions = [
    { icon: "shopping_cart", label: "Grocery",  nav: "grocery" },
    { icon: "restaurant_menu", label: "Meals",  nav: "meal-planner" },
    { icon: "task_alt", label: "Chores",         nav: "chores" },
    { icon: "sticky_note_2", label: "Notes",     nav: "notes" },
    { icon: "account_balance_wallet", label: "Finance", nav: "finances" },
  ];

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-y-auto overflow-x-hidden bg-[#fcf9f4] no-scrollbar"
    >
      {/* Ambient orbs — active when partner is online */}
      <AmbientOrbs active={heart.bothOnline} />

      {/* ── Sticky TopAppBar ─────────────────────────────────────────────── */}
      <motion.nav
        style={{ background: navBg }}
        className="sticky top-0 z-[100] flex justify-between items-center w-full px-5 pt-4 pb-3 backdrop-blur-xl"
      >
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 280, damping: 22 }}
          whileTap={{ scale: 0.88 }}
          onClick={() => onNavigate("settings")}
          className="w-9 h-9 rounded-full overflow-hidden border-2 cursor-pointer"
          style={{ borderColor: `${GOLD}40` }}
        >
          {userData?.photoURL
            ? <img src={userData.photoURL} alt="Me" className="w-full h-full object-cover" />
            : (
              <div className="w-full h-full flex items-center justify-center font-serif text-sm"
                style={{ background: `${GOLD}20`, color: GOLD }}>
                {userData?.displayName?.[0] ?? "U"}
              </div>
            )
          }
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 280, damping: 22 }}
          className="font-serif text-[26px] font-light text-[#1A1A1A] flex items-baseline gap-1 tracking-tight"
        >
          OurSpace
          <motion.span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: GOLD }}
            animate={{ scale: [1, 1.4, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 280, damping: 22 }}
          whileTap={{ scale: 0.88, rotate: 30 }}
          onClick={() => onNavigate("settings")}
          className="w-9 h-9 flex items-center justify-center cursor-pointer rounded-full hover:bg-[#B8955A]/10 transition-colors"
        >
          <span className="material-symbols-outlined text-[22px]" style={{ color: "rgba(28,28,25,0.45)" }}>settings</span>
        </motion.div>
      </motion.nav>

      <main className="px-5 pb-32 space-y-6 pt-2">
        {/* ── Greeting ───────────────────────────────────────────────────── */}
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18, duration: 0.5 }}
          className="font-serif italic text-[15px]"
          style={{ color: `${GOLD}90` }}
        >
          {getGreeting(userData?.displayName || "")}
        </motion.p>

        {/* ── Hero Memory ────────────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, type: "spring", stiffness: 260, damping: 22 }}
          className="relative"
        >
          {!loaded ? (
            <Shimmer className="w-full h-52 rounded-3xl" />
          ) : (
            <div className="w-full h-52 rounded-3xl overflow-hidden shadow-[0_16px_48px_rgba(0,0,0,0.10)] relative">
              <motion.img
                style={{ scale: heroScale, opacity: heroOpacity }}
                src={lastMemory?.imageURL || "https://images.unsplash.com/photo-1518199266791-5375a83190b7?auto=format&fit=crop&q=80&w=2070"}
                alt="Our latest memory"
                className="w-full h-full object-cover origin-center"
              />
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
              {lastMemory?.caption && (
                <p className="absolute bottom-4 left-5 right-16 text-white font-serif text-sm italic opacity-90 leading-snug line-clamp-2">
                  {lastMemory.caption}
                </p>
              )}
              {/* Memories pill */}
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={() => onNavigate("together")}
                className="absolute top-3 right-3 bg-white/90 backdrop-blur-md rounded-full px-3 py-1.5 flex items-center gap-1.5 shadow-md"
              >
                <span className="material-symbols-outlined text-[14px]" style={{ color: GOLD, fontVariationSettings: "'FILL' 1" }}>photo_library</span>
                <span className="text-[11px] font-medium text-[#1A1A1A]">Memories</span>
              </motion.button>
            </div>
          )}
        </motion.section>

        {/* ── Presence & Heartbeat ──────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.32, type: "spring", stiffness: 260, damping: 22 }}
          className="relative bg-white/60 backdrop-blur-sm rounded-3xl px-4 py-5 border border-black/[0.04] shadow-sm"
        >
          <HeartbeatSection userData={userData} partnerData={partnerData} heart={heart} />

          {/* Status line */}
          <motion.p
            className="text-center font-serif italic text-[11px] mt-3"
            style={{ color: `${GOLD}70` }}
            animate={{ opacity: heart.bothOnline ? [0.6, 1, 0.6] : 0.5 }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            {heart.bothOnline
              ? "You're both here ♥"
              : partnerData?.isOnline === false
                ? `${partnerData?.displayName?.split(" ")[0] || "Partner"} was last seen ${
                    partnerData?.lastOnlineAt
                      ? differenceInMinutes(new Date(), new Date(partnerData.lastOnlineAt)) < 60
                        ? `${differenceInMinutes(new Date(), new Date(partnerData.lastOnlineAt))}m ago`
                        : "a while ago"
                      : "recently"
                  }`
                : "Missing them..."
            }
          </motion.p>
        </motion.section>

        {/* ── Milestones ────────────────────────────────────────────────── */}
        <motion.section
          variants={stagger} initial="hidden" animate="show"
          className="grid grid-cols-2 gap-3"
        >
          {[
            { label: "Days Together", value: milestones.met,     icon: "favorite_border",  color: HEART_RED },
            { label: "Days Married",  value: milestones.married, icon: "diamond",           color: GOLD },
          ].map(({ label, value, icon, color }) => (
            <motion.div
              key={label}
              variants={rise}
              whileHover={cardHover}
              whileTap={cardTap}
              className="relative bg-white rounded-2xl p-5 text-center overflow-hidden border border-black/[0.04]"
              style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.05)" }}
            >
              <div className="absolute inset-0" style={{ background: `radial-gradient(circle at center, ${color}06, transparent 70%)` }} />
              <span
                className="material-symbols-outlined text-[22px] mb-2 block"
                style={{ color: `${color}90`, fontVariationSettings: "'FILL' 1" }}
              >
                {icon}
              </span>
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] mb-1" style={{ color: `${color}90` }}>{label}</p>
              {loaded
                ? (
                  <div>
                    <p className="font-serif text-[32px] font-bold text-[#1A1A1A] leading-none">
                      {value === 0 ? '—' : <CountUp end={value} />}
                    </p>
                    {value >= 365 && (
                      <p className="font-serif text-[10px] italic mt-0.5" style={{ color: `${color}70` }}>
                        {Math.floor(value / 365)}y {value % 365}d
                      </p>
                    )}
                  </div>
                )
                : <Shimmer className="h-9 w-20 mx-auto" />
              }
              {value === 0 && loaded && (
                <p className="font-outfit text-[9px] text-[#6B6560] mt-1">Set date in settings</p>
              )}
              {value > 0 && <p className="font-serif text-[10px] text-[#6B6560] italic mt-1">days</p>}
            </motion.div>
          ))}
        </motion.section>

        {/* ── Relationship Streak ──────────────────────────────────────── */}
        {streak > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38, type: "spring", stiffness: 260, damping: 22 }}
            className="bg-white rounded-3xl px-5 py-4 border border-black/[0.04] flex items-center gap-4"
            style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.05)" }}
          >
            <div className="relative flex-shrink-0">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-[28px]"
                style={{ background: streak >= 7 ? '#FFF3CD' : '#FFF8EE' }}>
                🔥
              </div>
              {streak >= 7 && (
                <motion.div
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#FF6B00] flex items-center justify-center"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  <span className="text-white text-[9px] font-bold">✓</span>
                </motion.div>
              )}
            </div>
            <div className="flex-1">
              <p className="font-serif text-[22px] text-[#1A1A1A] leading-none">
                {streak} day{streak !== 1 ? 's' : ''}
              </p>
              <p className="font-outfit text-[12px] text-[#6B6560] mt-0.5">
                {streak >= 14 ? 'Incredible streak — you\'re unstoppable 🏆' :
                 streak >= 7  ? 'Amazing week together! Keep it going' :
                 streak >= 3  ? 'Great momentum — don\'t break the chain' :
                                'Activity streak — keep it going'}
              </p>
            </div>
            <div className="flex-shrink-0 text-right">
              <p className="font-outfit text-[9px] uppercase tracking-wider text-[#B8955A]">Streak</p>
              <div className="flex gap-0.5 mt-1">
                {Array.from({ length: Math.min(streak, 7) }).map((_, i) => (
                  <div key={i} className="w-2 h-2 rounded-full bg-[#FF6B00] opacity-80" />
                ))}
              </div>
            </div>
          </motion.section>
        )}

        {/* ── Anniversary Countdown ─────────────────────────────────────── */}
        {daysToAnniversary !== null && (
          <motion.button
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42, type: "spring", stiffness: 260, damping: 22 }}
            onClick={() => onNavigate("together")}
            className="w-full bg-white rounded-3xl overflow-hidden border border-black/[0.04] text-left"
            style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.05)" }}
          >
            {firstMemory?.imageURL && (
              <div className="relative h-28 overflow-hidden">
                <img src={firstMemory.imageURL} alt="First memory" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <p className="absolute bottom-2 left-4 font-serif italic text-white text-[11px] opacity-80">
                  {firstMemory.caption || 'Our first memory together'}
                </p>
              </div>
            )}
            <div className="px-5 py-4 flex items-center justify-between">
              <div>
                <p className="font-outfit text-[9px] uppercase tracking-[0.18em] mb-1" style={{ color: `${GOLD}80` }}>
                  Anniversary
                </p>
                <p className="font-serif text-[20px] text-[#1A1A1A] leading-tight">
                  {daysToAnniversary === 0
                    ? '🎉 Happy Anniversary!'
                    : `${daysToAnniversary} day${daysToAnniversary !== 1 ? 's' : ''} away`}
                </p>
                {firstMemory && (
                  <p className="font-outfit text-[11px] text-[#6B6560] mt-0.5">
                    First memory: {firstMemory.date
                      ? format(firstMemory.date?.toDate ? firstMemory.date.toDate() : new Date(firstMemory.date), 'd MMM yyyy')
                      : '—'}
                  </p>
                )}
              </div>
              <span className="text-[32px]">💍</span>
            </div>
          </motion.button>
        )}

        {/* ── Daily Pulse Grid ─────────────────────────────────────────── */}
        <motion.section variants={stagger} initial="hidden" animate="show" className="grid grid-cols-2 gap-3">
          {pulseCards.map(({ icon, label, accent, body, badge, progress, onClick }, i) => (
            <motion.button
              key={label}
              variants={rise}
              whileHover={cardHover}
              whileTap={cardTap}
              onClick={onClick}
              className="bg-white rounded-2xl p-4 text-left flex flex-col justify-between h-36 relative overflow-hidden border border-black/[0.04]"
              style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.05)" }}
            >
              {/* Left accent border */}
              <div className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full" style={{ background: accent }} />
              <div className="flex justify-between items-start pl-3">
                <span
                  className="material-symbols-outlined text-[22px]"
                  style={{ color: accent, fontVariationSettings: "'FILL' 1" }}
                >
                  {icon}
                </span>
                {badge != null && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 400, delay: 0.3 + i * 0.07 }}
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: `${accent}20`, color: accent }}
                  >
                    {badge}
                  </motion.span>
                )}
              </div>
              <div className="pl-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.14em] mb-1" style={{ color: `${accent}80` }}>{label}</p>
                <p className="text-[13px] font-semibold text-[#1A1A1A] leading-tight line-clamp-2">{body}</p>
                {progress != null && progress > 0 && (
                  <div className="mt-2 h-1 bg-[#EDE8DF] rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 1.5, ease: "easeOut", delay: 0.8 }}
                      className="h-full rounded-full"
                      style={{ background: accent }}
                    />
                  </div>
                )}
              </div>
            </motion.button>
          ))}
        </motion.section>

        {/* ── AI Relationship Insights ─────────────────────────────────── */}
        <AnimatePresence>
          {insights && insights.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55, type: "spring", stiffness: 240, damping: 22 }}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] mb-3" style={{ color: `${GOLD}80` }}>
                🧠 Relationship Pulse
              </p>
              <div className="space-y-2.5">
                {insights.slice(0, 3).map((insight, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.6 + i * 0.08, type: "spring", stiffness: 280, damping: 24 }}
                    className="bg-white rounded-2xl p-4 border border-black/[0.04] relative overflow-hidden"
                    style={{ boxShadow: "0 6px 24px rgba(0,0,0,0.04)" }}
                  >
                    {/* Subtle left accent */}
                    <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full" style={{ background: GOLD }} />
                    <div className="pl-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[18px] leading-none">{insight.emoji}</span>
                        <span className="font-semibold text-[13px] text-[#1A1A1A] leading-snug">{insight.title}</span>
                      </div>
                      <p className="text-[12px] text-[#6B6560] leading-relaxed">{insight.body}</p>
                      {insight.action && (
                        <span
                          className="inline-block mt-2 text-[11px] font-medium px-2.5 py-1 rounded-full"
                          style={{ background: `${GOLD}18`, color: GOLD }}
                        >
                          {insight.action}
                        </span>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* ── Next Event Strip ────────────────────────────────────────── */}
        {pulseData.event.title && pulseData.event.title !== "Nothing planned" && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.62, type: "spring", stiffness: 240, damping: 22 }}
            onClick={() => onNavigate("calendar")}
            className="w-full bg-white rounded-2xl px-4 py-3 flex items-center gap-3 border border-black/[0.04] text-left"
            style={{ boxShadow: "0 6px 24px rgba(0,0,0,0.04)" }}
          >
            <span className="material-symbols-outlined text-[20px]" style={{ color: "#3BAA7C", fontVariationSettings: "'FILL' 1" }}>event</span>
            <div className="flex-1">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] mb-0.5" style={{ color: "#3BAA7C99" }}>Next Event</p>
              <p className="text-[13px] font-semibold text-[#1A1A1A] leading-tight">{pulseData.event.title}</p>
            </div>
            <span className="material-symbols-outlined text-[16px] opacity-30">chevron_right</span>
          </motion.button>
        )}

        {/* ── Quick Actions ─────────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65, type: "spring", stiffness: 240, damping: 22 }}
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] mb-3" style={{ color: `${GOLD}80` }}>Quick Access</p>
          <div className="flex gap-2.5 overflow-x-auto pb-1 no-scrollbar">
            {quickActions.map(({ icon, label, nav }, i) => (
              <motion.button
                key={label}
                initial={{ opacity: 0, y: 12, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.7 + i * 0.06, type: "spring", stiffness: 300 }}
                whileHover={{ y: -3, scale: 1.05 }}
                whileTap={{ scale: 0.93 }}
                onClick={() => onNavigate(nav)}
                className="flex flex-col items-center gap-1.5 flex-shrink-0 px-4 py-3 bg-white rounded-2xl border border-black/[0.04] shadow-sm min-w-[68px]"
              >
                <span
                  className="material-symbols-outlined text-[20px]"
                  style={{ color: GOLD, fontVariationSettings: "'FILL' 0" }}
                >
                  {icon}
                </span>
                <span className="text-[10px] font-medium text-[#6B6560] whitespace-nowrap leading-none">{label}</span>
              </motion.button>
            ))}
          </div>
        </motion.section>

        {/* ── Today's date footer ───────────────────────────────────────── */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="text-center font-serif italic text-[11px] pt-2"
          style={{ color: `${GOLD}50` }}
        >
          {format(new Date(), "EEEE, MMMM d")}
        </motion.p>
      </main>
    </div>
  );
}
