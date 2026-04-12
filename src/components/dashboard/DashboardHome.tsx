import { useState, useEffect, useRef, useMemo } from "react";
import {
  motion,
  AnimatePresence,
  useScroll,
  useTransform,
  animate,
  useMotionValue,
  useSpring,
} from "motion/react";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../AuthWrapper";
import { differenceInDays, differenceInMinutes } from "date-fns";
import { startProactiveBrain } from "../../services/proactiveBrain";
import { cn } from "../../lib/utils";

const GOLD = "#B8955A";
const GOLD_RGB = "184, 149, 90";

// ─── Count-up Number Animator ───────────────────────────────────────────────
function CountUp({ end, duration = 2 }: { end: number; duration?: number }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (end === 0) return;
    const controls = animate(0, end, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setCount(Math.floor(v)),
    });
    return () => controls.stop();
  }, [end, duration]);
  return <>{count.toLocaleString()}</>;
}

// ─── Intelligent Heartbeat Hook ───────────────────────────────────────────────
function useHeartbeatState(
  partnerIsOnline: boolean,
  partnerLastOnlineAt: string | null
) {
  const bothOnline = partnerIsOnline; // user is always online when viewing
  const [justReunited, setJustReunited] = useState(false);
  const prevBothOnline = useRef(false);

  useEffect(() => {
    if (bothOnline && !prevBothOnline.current) {
      setJustReunited(true);
      const t = setTimeout(() => setJustReunited(false), 4500);
      return () => clearTimeout(t);
    }
    prevBothOnline.current = bothOnline;
  }, [bothOnline]);

  const { opacity, speed, color } = useMemo(() => {
    if (bothOnline) return { opacity: 1, speed: 1.4, color: GOLD };
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

// ─── Shared animation variants ───────────────────────────────────────────────
const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 280, damping: 24 } },
};
const cardHover = { y: -4, scale: 1.02, transition: { type: 'spring' as const, stiffness: 400, damping: 22 } };
const cardTap   = { scale: 0.97, transition: { duration: 0.1 } };

// ─── DashboardHome ────────────────────────────────────────────────────────────
export default function DashboardHome({ onNavigate }: { onNavigate: (t: string) => void }) {
  const { user, householdId, userData } = useAuth();
  const [partnerData, setPartnerData] = useState<any>(null);
  const [lastMemory, setLastMemory] = useState<any>(null);
  const [milestones, setMilestones] = useState({ met: 0, married: 0 });
  const [pulseData, setPulseData] = useState({
    birthday: { name: "", days: 0 },
    chores: { count: 0 },
    goal: { name: "", progress: 0 },
    event: { title: "" },
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: containerRef });
  const heroY      = useTransform(scrollY, [0, 300], [0, 60]);
  const heroOpacity = useTransform(scrollY, [0, 200], [1, 0.6]);

  // ── Firestore listeners ────────────────────────────────────────────────────
  useEffect(() => {
    if (!householdId || !user) return;
    const unsubHousehold = onSnapshot(doc(db, "households", householdId), (snap) => {
      const hData = snap.data();
      const pId = hData?.memberIds?.find((id: string) => id !== user.uid);
      if (hData?.createdAt) {
        setMilestones((m) => ({ ...m, met: differenceInDays(new Date(), hData.createdAt.toDate()) }));
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
            setPulseData((p) => ({
              ...p,
              birthday: { name: pData.displayName || "Partner", days: differenceInDays(bday, today) },
            }));
          }
          if (pData?.anniversaryDate) {
            setMilestones((m) => ({ ...m, married: differenceInDays(new Date(), new Date(pData.anniversaryDate)) }));
          }
        });
      }
    });

    const unsubMemory = onSnapshot(
      query(collection(db, "households", householdId, "memories"), orderBy("date", "desc"), limit(1)),
      (snap) => { if (snap.docs[0]) setLastMemory(snap.docs[0].data()); }
    );

    const unsubChores = onSnapshot(
      query(collection(db, "households", householdId, "chores"), where("completed", "==", false)),
      (snap) => setPulseData((p) => ({ ...p, chores: { count: snap.size } }))
    );

    const unsubGoals = onSnapshot(
      query(collection(db, "households", householdId, "savingsGoals"), orderBy("currentAmount", "desc"), limit(1)),
      (snap) => {
        const g = snap.docs[0]?.data();
        if (g) setPulseData((p) => ({ ...p, goal: { name: g.title, progress: (g.currentAmount / g.targetAmount) * 100 } }));
      }
    );

    onSnapshot(
      query(collection(db, "households", householdId, "events"), where("date", ">=", Timestamp.now()), orderBy("date", "asc"), limit(1)),
      (snap) => setPulseData((p) => ({ ...p, event: { title: snap.docs[0]?.data()?.title || "Nothing planned yet" } }))
    );

    return () => { unsubHousehold(); unsubMemory(); unsubChores(); unsubGoals(); };
  }, [householdId, user?.uid]);

  useEffect(() => {
    if (!householdId || !user || !partnerData?.uid) return;
    const stop = startProactiveBrain(householdId, user.uid, partnerData.uid);
    return () => stop();
  }, [householdId, user?.uid, partnerData?.uid]);

  const heart = useHeartbeatState(!!partnerData?.isOnline, partnerData?.lastOnlineAt || null);

  // ── Pulse cards config ────────────────────────────────────────────────────
  const pulseCards = [
    {
      icon: "cake",
      label: "Birthday",
      accent: "#E17B9B",
      body: pulseData.birthday.name
        ? `${pulseData.birthday.name.split(" ")[0]}'s birthday in ${pulseData.birthday.days}d`
        : "No upcoming birthdays",
      badge: pulseData.birthday.days > 0 ? `${pulseData.birthday.days}d` : null,
      onClick: () => onNavigate("together"),
    },
    {
      icon: "assignment",
      label: "Tasks",
      accent: "#5B68E8",
      body: pulseData.chores.count > 0 ? "Shared errands pending" : "All caught up! ✓",
      badge: pulseData.chores.count > 0 ? `${pulseData.chores.count}` : null,
      onClick: () => onNavigate("more"),
    },
    {
      icon: "savings",
      label: "Savings",
      accent: GOLD,
      body: pulseData.goal.name || "Set a shared goal",
      badge: pulseData.goal.progress > 0 ? `${Math.round(pulseData.goal.progress)}%` : null,
      progress: pulseData.goal.progress,
      onClick: () => onNavigate("finances"),
    },
    {
      icon: "event",
      label: "Next Event",
      accent: "#3BAA7C",
      body: pulseData.event.title,
      badge: null,
      onClick: () => onNavigate("calendar"),
    },
  ];

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-y-auto overflow-x-hidden bg-[#fcf9f4] no-scrollbar"
    >
      {/* ── TopAppBar ─────────────────────────────────────────────────────── */}
      <motion.nav
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 22 }}
        className="sticky top-0 z-[100] flex justify-between items-center w-full px-5 pt-4 pb-3 bg-[#fcf9f4]/80 backdrop-blur-xl"
      >
        <motion.div
          whileTap={{ scale: 0.9 }}
          onClick={() => onNavigate("settings")}
          className="w-9 h-9 rounded-full overflow-hidden border-2 cursor-pointer"
          style={{ borderColor: `${GOLD}40` }}
        >
          {userData?.photoURL
            ? <img src={userData.photoURL} alt="Me" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center font-serif text-sm" style={{ background: `${GOLD}20`, color: GOLD }}>
                {userData?.displayName?.[0] ?? "U"}
              </div>
          }
        </motion.div>

        {/* OurSpace wordmark */}
        <h1 className="font-serif text-[26px] font-light text-[#1A1A1A] flex items-baseline gap-1 tracking-tight">
          OurSpace
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: GOLD }} />
        </h1>

        <motion.div
          whileTap={{ scale: 0.88, rotate: 30 }}
          onClick={() => onNavigate("settings")}
          className="w-9 h-9 flex items-center justify-center cursor-pointer rounded-full hover:bg-[#B8955A]/10 transition-colors"
        >
          <span className="material-symbols-outlined text-[22px]" style={{ color: "rgba(28,28,25,0.5)" }}>settings</span>
        </motion.div>
      </motion.nav>

      <main className="px-5 pb-32 space-y-6 pt-2">
        {/* ── Hero Memory ────────────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 260, damping: 22 }}
        >
          <motion.div
            style={{ y: heroY, opacity: heroOpacity }}
            className="w-full h-52 rounded-3xl overflow-hidden shadow-[0_16px_48px_rgba(0,0,0,0.10)] relative"
          >
            <img
              src={lastMemory?.imageURL || "https://images.unsplash.com/photo-1518199266791-5375a83190b7?auto=format&fit=crop&q=80&w=2070"}
              alt="Our latest memory"
              className="w-full h-full object-cover"
            />
            {lastMemory?.caption && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-5 pb-4 pt-8">
                <p className="text-white font-serif text-sm italic opacity-90">{lastMemory.caption}</p>
              </div>
            )}
            {/* Tap to Stories */}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => onNavigate("together")}
              className="absolute top-3 right-3 bg-white/90 backdrop-blur-md rounded-full px-3 py-1.5 flex items-center gap-1.5 shadow-md"
            >
              <span className="material-symbols-outlined text-[14px]" style={{ color: GOLD, fontVariationSettings: "'FILL' 1" }}>photo_library</span>
              <span className="text-[11px] font-medium text-[#1A1A1A]">Memories</span>
            </motion.button>
          </motion.div>
        </motion.section>

        {/* ── Presence & Heartbeat ──────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, type: "spring", stiffness: 260, damping: 22 }}
          className="flex items-center justify-center gap-6 py-2"
        >
          {/* User avatar */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="relative">
              <div className="w-16 h-16 rounded-full overflow-hidden border-2 shadow-lg" style={{ borderColor: `${GOLD}60` }}>
                {userData?.photoURL
                  ? <img src={userData.photoURL} alt="Me" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center font-serif text-lg" style={{ background: `${GOLD}15`, color: GOLD }}>{userData?.displayName?.[0]}</div>
                }
              </div>
              <motion.div
                animate={{ scale: [1, 1.5, 1], opacity: [0.8, 0, 0.8] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                className="absolute -inset-1 rounded-full border"
                style={{ borderColor: `${GOLD}40` }}
              />
              <div className="absolute bottom-0 right-0 w-4 h-4 bg-green-400 border-2 border-white rounded-full shadow-sm" />
            </div>
            <p className="text-[11px] font-medium text-[#1A1A1A]">{userData?.displayName?.split(" ")[0] || "You"}</p>
          </div>

          {/* Central Heart */}
          <div className="relative flex flex-col items-center">
            <AnimatePresence>
              {heart.justReunited && (
                <>
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      initial={{ scale: 0.3, opacity: 0.9 }}
                      animate={{ scale: 3.5 + i * 0.8, opacity: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 1.8, delay: i * 0.25, ease: "easeOut" }}
                      className="absolute inset-0 rounded-full border-2"
                      style={{ borderColor: GOLD, zIndex: -1 }}
                    />
                  ))}
                  {Array.from({ length: 8 }).map((_, i) => {
                    const angle = (i / 8) * Math.PI * 2;
                    return (
                      <motion.div
                        key={`spark-${i}`}
                        initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                        animate={{ x: Math.cos(angle) * 70, y: Math.sin(angle) * 70, opacity: 0, scale: 0 }}
                        transition={{ duration: 1.3, delay: 0.15, ease: "easeOut" }}
                        className="absolute w-2 h-2 rounded-full"
                        style={{ background: GOLD, top: "50%", left: "50%", marginTop: -4, marginLeft: -4, zIndex: -1 }}
                      />
                    );
                  })}
                </>
              )}
            </AnimatePresence>

            <motion.button
              whileTap={{ scale: 0.85 }}
              animate={
                heart.bothOnline
                  ? { scale: [1, 1.22, 1, 1.22, 1], filter: [`drop-shadow(0 0 6px ${heart.color})`, `drop-shadow(0 0 22px ${heart.color})`, `drop-shadow(0 0 6px ${heart.color})`, `drop-shadow(0 0 22px ${heart.color})`, `drop-shadow(0 0 6px ${heart.color})`] }
                  : { scale: [1, 1.04, 1], filter: `drop-shadow(0 0 4px ${heart.color})` }
              }
              transition={{
                duration: heart.speed,
                repeat: Infinity,
                ease: "easeInOut",
                times: heart.bothOnline ? [0, 0.12, 0.25, 0.38, 1] : [0, 0.5, 1],
              }}
              style={{ opacity: heart.opacity }}
            >
              <span
                className="material-symbols-outlined text-[60px]"
                style={{ color: heart.color, fontVariationSettings: "'FILL' 1" }}
              >
                favorite
              </span>
            </motion.button>

            <AnimatePresence>
              {heart.justReunited && (
                <motion.p
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="font-serif italic text-[11px] mt-1 tracking-wider whitespace-nowrap"
                  style={{ color: GOLD }}
                >
                  together again ♥
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Partner avatar */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="relative">
              <div className="w-16 h-16 rounded-full overflow-hidden border-2 shadow-lg" style={{ borderColor: partnerData?.isOnline ? `${GOLD}60` : "rgba(0,0,0,0.1)" }}>
                {partnerData?.photoURL
                  ? <img src={partnerData.photoURL} alt="Partner" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center font-serif text-lg bg-stone-200 text-stone-400">{partnerData?.displayName?.[0] ?? "?"}</div>
                }
              </div>
              {partnerData?.isOnline && (
                <motion.div
                  animate={{ scale: [1, 1.5, 1], opacity: [0.8, 0, 0.8] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                  className="absolute -inset-1 rounded-full border"
                  style={{ borderColor: `${GOLD}40` }}
                />
              )}
              <div className={cn(
                "absolute bottom-0 right-0 w-4 h-4 border-2 border-white rounded-full shadow-sm transition-colors",
                partnerData?.isOnline ? "bg-green-400" : "bg-stone-300"
              )} />
            </div>
            <p className="text-[11px] font-medium text-[#1A1A1A]">{partnerData?.displayName?.split(" ")[0] || "Partner"}</p>
          </div>
        </motion.section>

        {/* ── Milestones ────────────────────────────────────────────────── */}
        <motion.section
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 gap-3"
        >
          {[
            { label: "Days Together", value: milestones.met },
            { label: "Days Married", value: milestones.married },
          ].map(({ label, value }) => (
            <motion.div
              key={label}
              variants={itemVariants}
              whileHover={cardHover}
              whileTap={cardTap}
              className="bg-white rounded-2xl p-5 text-center shadow-sm border border-black/5 cursor-default"
              style={{ boxShadow: "0 12px 36px rgba(0,0,0,0.05)" }}
            >
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#B8955A]/70 mb-2">{label}</p>
              <p className="font-serif text-3xl font-bold text-[#1A1A1A]">
                <CountUp end={value} />
              </p>
              <p className="font-serif text-[10px] text-[#6B6560] italic mt-1">days</p>
            </motion.div>
          ))}
        </motion.section>

        {/* ── Daily Pulse Grid (2 × 2) ──────────────────────────────────── */}
        <motion.section
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 gap-3"
        >
          {pulseCards.map(({ icon, label, accent, body, badge, progress, onClick }) => (
            <motion.button
              key={label}
              variants={itemVariants}
              whileHover={cardHover}
              whileTap={cardTap}
              onClick={onClick}
              className="bg-white rounded-2xl p-4 text-left flex flex-col justify-between h-36 shadow-sm border border-black/5 relative overflow-hidden"
              style={{ boxShadow: "0 12px 36px rgba(0,0,0,0.05)" }}
            >
              {/* Coloured left accent */}
              <div className="absolute left-0 top-4 bottom-4 w-1 rounded-r-full" style={{ background: accent }} />
              <div className="flex justify-between items-start pl-3">
                <span
                  className="material-symbols-outlined text-2xl"
                  style={{ color: accent, fontVariationSettings: "'FILL' 1" }}
                >
                  {icon}
                </span>
                {badge != null && (
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: `${accent}20`, color: accent }}
                  >
                    {badge}
                  </span>
                )}
              </div>
              <div className="pl-3">
                <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#6B6560]/60 mb-1">{label}</p>
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

        {/* ── Quick Actions strip ───────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, type: "spring", stiffness: 240, damping: 22 }}
          className="flex gap-3 overflow-x-auto pb-1 no-scrollbar"
        >
          {[
            { icon: "shopping_cart", label: "Grocery", nav: "more", sub: "grocery" },
            { icon: "restaurant_menu", label: "Meals",   nav: "more", sub: "meal-planner" },
            { icon: "task_alt",       label: "Chores",   nav: "more", sub: "chores" },
            { icon: "sticky_note_2",  label: "Notes",    nav: "more", sub: "notes" },
          ].map(({ icon, label }) => (
            <motion.button
              key={label}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.93 }}
              className="flex flex-col items-center gap-1.5 flex-shrink-0 px-4 py-3 bg-white rounded-2xl border border-black/5 shadow-sm min-w-[72px]"
              onClick={() => onNavigate("more")}
            >
              <span
                className="material-symbols-outlined text-[22px]"
                style={{ color: GOLD, fontVariationSettings: "'FILL' 0" }}
              >
                {icon}
              </span>
              <span className="text-[11px] font-medium text-[#6B6560] whitespace-nowrap">{label}</span>
            </motion.button>
          ))}
        </motion.section>
      </main>
    </div>
  );
}
