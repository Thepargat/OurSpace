import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  setDoc,
  doc,
  Timestamp,
} from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../AuthWrapper";
import { format, subDays, eachDayOfInterval, differenceInDays } from "date-fns";

// ─── Mood config ────────────────────────────────────────────────────────────
const MOODS = [
  { score: 1, emoji: "😔", label: "Rough",     color: "#C47B6A", bg: "#FDF0ED" },
  { score: 2, emoji: "😕", label: "Meh",        color: "#C4976A", bg: "#FDF5ED" },
  { score: 3, emoji: "😊", label: "Okay",       color: "#B8955A", bg: "#FBF5EB" },
  { score: 4, emoji: "😄", label: "Good",       color: "#6B9B6A", bg: "#EBF5EA" },
  { score: 5, emoji: "🥰", label: "Amazing",    color: "#B8955A", bg: "#FBF5EB" },
];

const GOLD = "#B8955A";

interface MoodEntry {
  userId: string;
  date: string;    // YYYY-MM-DD
  mood: number;    // 1-5
  note?: string;
  createdAt: any;
}

interface MoodHistoryTabProps {
  onBack?: () => void;
}

// ─── Compact mood dot for calendar grid ─────────────────────────────────────
function MoodDot({ score, size = 32 }: { score?: number; size?: number }) {
  const m = score ? MOODS[score - 1] : null;
  return (
    <div
      className="rounded-full flex items-center justify-center text-[14px] flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: m ? m.bg : "#EDE8DF",
        border: m ? `1.5px solid ${m.color}30` : "1.5px solid #D4CEC430",
      }}
    >
      {m ? m.emoji : <span className="text-[10px] text-[#C4C0BA]">—</span>}
    </div>
  );
}

// ─── Analysis card ───────────────────────────────────────────────────────────
function AnalysisCard({ myMoods, partnerMoods, partnerName }: {
  myMoods: MoodEntry[];
  partnerMoods: MoodEntry[];
  partnerName: string;
}) {
  // Sync days (both logged and both >= 4)
  const syncDays = myMoods.filter(m => {
    const pm = partnerMoods.find(p => p.date === m.date);
    return pm && m.mood >= 4 && pm.mood >= 4;
  });

  // My avg
  const myAvg = myMoods.length > 0
    ? (myMoods.reduce((s, m) => s + m.mood, 0) / myMoods.length).toFixed(1)
    : null;
  const partnerAvg = partnerMoods.length > 0
    ? (partnerMoods.reduce((s, m) => s + m.mood, 0) / partnerMoods.length).toFixed(1)
    : null;

  // Current streak
  let streak = 0;
  for (let i = 0; i < 30; i++) {
    const d = format(subDays(new Date(), i), "yyyy-MM-dd");
    if (myMoods.find(m => m.date === d)) streak++;
    else break;
  }

  const stats = [
    { label: "Your Avg", value: myAvg ? `${myAvg}/5` : "—", emoji: "😊" },
    { label: `${partnerName}'s Avg`, value: partnerAvg ? `${partnerAvg}/5` : "—", emoji: "💑" },
    { label: "Sync Days", value: `${syncDays.length}`, emoji: "✨" },
    { label: "Your Streak", value: `${streak}d`, emoji: "🔥" },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, type: "spring", stiffness: 260, damping: 22 }}
      className="bg-white rounded-3xl p-5 border border-black/[0.04]"
      style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.05)" }}
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[18px]">🧠</span>
        <p className="font-serif text-[14px] text-[#1A1A1A]">30-Day Mood Analysis</p>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {stats.map(({ label, value, emoji }) => (
          <div
            key={label}
            className="rounded-2xl p-3 text-center"
            style={{ background: `${GOLD}10` }}
          >
            <span className="text-[18px] block mb-1">{emoji}</span>
            <p className="font-serif text-[18px] font-bold text-[#1A1A1A]">{value}</p>
            <p className="text-[9px] uppercase tracking-widest font-bold mt-0.5" style={{ color: `${GOLD}90` }}>
              {label}
            </p>
          </div>
        ))}
      </div>

      {syncDays.length > 0 && (
        <div className="mt-4 p-3 rounded-2xl" style={{ background: "#EBF5EA" }}>
          <p className="text-[12px] text-[#3D7A3C] leading-snug">
            💚 You and {partnerName} were both in a great mood on {syncDays.length} day{syncDays.length > 1 ? "s" : ""} this month!
          </p>
        </div>
      )}
    </motion.div>
  );
}

export default function MoodHistoryTab({ onBack }: MoodHistoryTabProps) {
  const { user, householdId, userData } = useAuth();
  const [moods, setMoods] = useState<MoodEntry[]>([]);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [partnerData, setPartnerData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [todayNote, setTodayNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [showNoteInput, setShowNoteInput] = useState(false);

  const today = format(new Date(), "yyyy-MM-dd");

  // ── Partner setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!householdId || !user) return;
    const unsub = onSnapshot(doc(db, "households", householdId), (snap) => {
      const pId = snap.data()?.memberIds?.find((id: string) => id !== user.uid);
      if (pId) {
        setPartnerId(pId);
        onSnapshot(doc(db, "users", pId), (ps) => setPartnerData(ps.data()));
      }
    });
    return () => unsub();
  }, [householdId, user]);

  // ── Moods listener ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!householdId || !user) return;
    const thirtyDaysAgo = subDays(new Date(), 30);
    const q = query(
      collection(db, "households", householdId, "moods"),
      where("createdAt", ">=", Timestamp.fromDate(thirtyDaysAgo)),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setMoods(snap.docs.map(d => d.data() as MoodEntry));
      setLoading(false);
    });
    return () => unsub();
  }, [householdId, user]);

  // ── Log mood ───────────────────────────────────────────────────────────────
  const logMood = useCallback(async (score: number) => {
    if (!user || !householdId || saving) return;
    setSaving(true);
    try {
      const docId = `${user.uid}_${today}`;
      await setDoc(doc(db, "households", householdId, "moods", docId), {
        userId: user.uid,
        date: today,
        mood: score,
        note: todayNote.trim() || null,
        createdAt: Timestamp.now(),
      });
      setTodayNote("");
      setShowNoteInput(false);
    } catch (e) {
      alert("Couldn't save mood. Try again.");
    } finally {
      setSaving(false);
    }
  }, [user, householdId, today, todayNote, saving]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const myMoods = moods.filter(m => m.userId === user?.uid);
  const partnerMoods = moods.filter(m => m.userId === partnerId);
  const myTodayMood = myMoods.find(m => m.date === today);
  const partnerTodayMood = partnerMoods.find(m => m.date === today);
  const partnerFirstName = partnerData?.displayName?.split(" ")[0] || "Partner";
  const myFirstName = userData?.displayName?.split(" ")[0] || "You";

  const days = eachDayOfInterval({
    start: subDays(new Date(), 13), // last 14 days
    end: new Date(),
  }).reverse();

  return (
    <div className="min-h-screen bg-[#fcf9f4] pb-28 overflow-y-auto">
      {/* Header */}
      <div className="pt-14 pb-4 px-5">
        <p className="font-serif italic text-[12px] mb-1" style={{ color: `${GOLD}80` }}>
          {format(new Date(), "EEEE, MMMM d")}
        </p>
        <h1 className="font-serif text-[28px] text-[#1A1A1A] font-light">
          Mood
        </h1>
      </div>

      <div className="px-5 space-y-5">
        {/* ── Log today's mood ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          className="bg-white rounded-3xl p-5 border border-black/[0.04]"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.05)" }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-serif text-[15px] text-[#1A1A1A]">
                {myTodayMood ? "Today's mood ✓" : "How are you feeling?"}
              </p>
              <p className="text-[11px] text-[#6B6560] mt-0.5">
                {myTodayMood
                  ? `You logged ${MOODS[myTodayMood.mood - 1].emoji} ${MOODS[myTodayMood.mood - 1].label}`
                  : "Tap to log your mood for today"}
              </p>
            </div>
            {myTodayMood && (
              <MoodDot score={myTodayMood.mood} size={44} />
            )}
          </div>

          {/* Mood selector */}
          <div className="flex justify-between gap-2">
            {MOODS.map((m) => (
              <motion.button
                key={m.score}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.92 }}
                onClick={() => {
                  if (m.score !== myTodayMood?.mood) {
                    setShowNoteInput(true);
                  }
                  logMood(m.score);
                }}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-2xl transition-all"
                style={{
                  background: myTodayMood?.mood === m.score ? m.bg : "#F8F5F0",
                  border: myTodayMood?.mood === m.score
                    ? `2px solid ${m.color}50`
                    : "2px solid transparent",
                }}
              >
                <span className="text-[22px]">{m.emoji}</span>
                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: m.color }}>
                  {m.label}
                </span>
              </motion.button>
            ))}
          </div>

          {/* Note input */}
          <AnimatePresence>
            {showNoteInput && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 pt-3 border-t border-black/[0.05]">
                  <input
                    type="text"
                    value={todayNote}
                    onChange={e => setTodayNote(e.target.value)}
                    placeholder="Add a note (optional)..."
                    className="w-full text-[13px] bg-[#F8F5F0] rounded-xl px-3 py-2.5 outline-none text-[#1A1A1A] placeholder:text-[#C4C0BA]"
                    onKeyDown={e => {
                      if (e.key === "Enter" && myTodayMood) {
                        logMood(myTodayMood.mood);
                      }
                    }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ── Partner's mood today ──────────────────────────────────────────── */}
        {partnerData && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 22 }}
            className="flex items-center gap-4 bg-white rounded-2xl px-4 py-3.5 border border-black/[0.04]"
            style={{ boxShadow: "0 4px 16px rgba(0,0,0,0.04)" }}
          >
            {partnerData.photoURL
              ? <img src={partnerData.photoURL} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
              : (
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-serif flex-shrink-0"
                  style={{ background: `${GOLD}20`, color: GOLD }}>
                  {partnerData.displayName?.[0] ?? "P"}
                </div>
              )
            }
            <div className="flex-1">
              <p className="font-outfit text-[13px] font-semibold text-[#1A1A1A]">
                {partnerFirstName}'s mood today
              </p>
              <p className="text-[12px] text-[#6B6560]">
                {partnerTodayMood
                  ? `${MOODS[partnerTodayMood.mood - 1].emoji} ${MOODS[partnerTodayMood.mood - 1].label}`
                  : "Not logged yet"}
              </p>
            </div>
            <MoodDot score={partnerTodayMood?.mood} size={40} />
          </motion.div>
        )}

        {/* ── 14-day calendar grid ─────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 260, damping: 22 }}
          className="bg-white rounded-3xl p-5 border border-black/[0.04]"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.05)" }}
        >
          <p className="font-serif text-[14px] text-[#1A1A1A] mb-3">Last 14 Days</p>
          <div className="flex items-center gap-3 mb-3">
            <MoodDot score={3} size={18} />
            <span className="text-[10px] text-[#6B6560] uppercase tracking-wider font-bold">{myFirstName}</span>
            <MoodDot score={4} size={18} />
            <span className="text-[10px] text-[#6B6560] uppercase tracking-wider font-bold">{partnerFirstName}</span>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-[#B8955A] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {days.map((day, i) => {
                const ds = format(day, "yyyy-MM-dd");
                const mine = myMoods.find(m => m.date === ds);
                const theirs = partnerMoods.find(m => m.date === ds);
                const isToday = ds === today;
                const bothHappy = mine && theirs && mine.mood >= 4 && theirs.mood >= 4;

                return (
                  <motion.div
                    key={ds}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.025, type: "spring", stiffness: 280, damping: 24 }}
                    className="flex items-center gap-3 rounded-2xl px-3 py-2"
                    style={{
                      background: bothHappy ? "#EBF5EA" : isToday ? `${GOLD}10` : "transparent",
                    }}
                  >
                    <div className="w-16 flex-shrink-0">
                      <p className={`text-[11px] font-bold ${isToday ? "text-[#B8955A]" : "text-[#1A1A1A]"}`}>
                        {isToday ? "Today" : format(day, "EEE d")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-1">
                      <MoodDot score={mine?.mood} size={32} />
                      <MoodDot score={theirs?.mood} size={32} />
                      {bothHappy && <span className="text-[14px] ml-1">✨</span>}
                    </div>
                    {mine?.note && (
                      <p className="text-[10px] text-[#6B6560] italic truncate max-w-[80px]">
                        "{mine.note}"
                      </p>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* ── Analysis ─────────────────────────────────────────────────────── */}
        {!loading && myMoods.length > 0 && (
          <AnalysisCard
            myMoods={myMoods}
            partnerMoods={partnerMoods}
            partnerName={partnerFirstName}
          />
        )}

        {/* ── Empty state ───────────────────────────────────────────────────── */}
        {!loading && myMoods.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-8"
          >
            <p className="text-[32px] mb-3">🌱</p>
            <p className="font-serif text-[16px] text-[#1A1A1A] mb-2">Start your streak</p>
            <p className="text-[13px] text-[#6B6560]">Log your mood daily to see patterns and connect with {partnerFirstName}.</p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
