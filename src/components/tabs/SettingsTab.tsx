import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  Camera,
  Loader2,
  ChevronLeft,
  ChevronRight,
  CalendarHeart,
  Wallet,
  ShoppingCart,
  Calendar,
  Download,
  Share2,
  Shield,
  FileText,
  Globe,
  Link as LinkIcon,
  Heart,
  Gift,
  Cake,
  DollarSign,
  Bell,
  User,
  Users,
  Trash2,
} from 'lucide-react';
import { doc, updateDoc, onSnapshot, collection, query, where, getDocs, addDoc, setDoc, Timestamp, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { format } from 'date-fns';
import { db, auth, storage } from '../../firebase';
import { updateProfile } from 'firebase/auth';
import { useAuth } from '../AuthWrapper';
import { NotificationPrefs } from '../../services/notificationService';
import BottomSheet from '../ui/BottomSheet';

// ─── Reusable row ─────────────────────────────────────────────────────────────
const SettingsRow = ({
  icon: Icon,
  label,
  subtext,
  onClick,
  rightElement,
  showChevron = true,
  danger = false,
}: {
  icon: any;
  label: string;
  subtext?: string;
  onClick?: () => void;
  rightElement?: React.ReactNode;
  showChevron?: boolean;
  danger?: boolean;
}) => (
  <motion.div
    whileTap={{ scale: 0.98, background: '#EDE8DF' }}
    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '0 20px',
      minHeight: 56,
      background: '#fcf9f4',
      borderBottom: '1px solid #D4CEC4',
      cursor: onClick ? 'pointer' : 'default',
    }}
  >
    <Icon size={20} color={danger ? '#C97B6A' : '#B8955A'} style={{ flexShrink: 0 }} />
    <div style={{ flex: 1 }}>
      <p style={{ fontFamily: "'Outfit'", fontSize: 14, color: danger ? '#C97B6A' : '#1A1A1A', margin: 0 }}>
        {label}
      </p>
      {subtext && (
        <p style={{ fontFamily: "'Outfit'", fontSize: 12, color: '#6B6560', margin: 0, lineHeight: 1.4 }}>
          {subtext}
        </p>
      )}
    </div>
    {rightElement || (showChevron && onClick && <ChevronRight size={16} color="#D4CEC4" />)}
  </motion.div>
);

// ─── Toggle ───────────────────────────────────────────────────────────────────
const ToggleSwitch = ({ active, onToggle }: { active: boolean; onToggle: () => void }) => (
  <motion.div
    onClick={(e) => { e.stopPropagation(); onToggle(); }}
    animate={{ backgroundColor: active ? '#1A1A1A' : '#D4CEC4' }}
    style={{ width: 44, height: 26, borderRadius: 999, position: 'relative', cursor: 'pointer', padding: 3 }}
  >
    <motion.div
      animate={{ x: active ? 18 : 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      style={{ width: 20, height: 20, borderRadius: '50%', background: 'white' }}
    />
  </motion.div>
);

// ─── Section label ────────────────────────────────────────────────────────────
const SectionLabel = ({ children }: { children: string }) => (
  <h3 style={{
    fontFamily: "'Outfit'",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: '#B8955A',
    textTransform: 'uppercase',
    margin: '28px 4px 8px',
  }}>
    {children}
  </h3>
);

// ─── Date helpers ─────────────────────────────────────────────────────────────
const ensureDate = (val: any): Date | null => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val.toDate === 'function') return val.toDate();
  if (typeof val === 'object' && val.seconds !== undefined) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const fmtDate = (val: any) => {
  const d = ensureDate(val);
  return d ? format(d, 'MMMM d, yyyy') : null;
};

// ─── Main component ───────────────────────────────────────────────────────────
export default function SettingsTab({ onBack }: { onBack: () => void }) {
  const { user, userData, householdId, googleAccessToken, connectGoogleCalendar, clearGoogleToken } = useAuth();

  // ── profile state ──
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(userData?.displayName || user?.displayName || '');
  const [isUploading, setIsUploading] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── household / partner state ──
  const [partner, setPartner] = useState<any>(null);
  const [household, setHousehold] = useState<any>(null);

  // ── invite state ──
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [partnerEmail, setPartnerEmail] = useState('');
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);

  // ── sheets ──
  const [showBudgetSheet, setShowBudgetSheet] = useState(false);
  const [showIncomeSheet, setShowIncomeSheet] = useState(false);
  const [showSignOutSheet, setShowSignOutSheet] = useState(false);
  const [budgetLimit, setBudgetLimit] = useState('');
  const [monthlyIncomeInput, setMonthlyIncomeInput] = useState('');

  // ── Listen to household + partner ─────────────────────────────────────────
  useEffect(() => {
    if (!householdId || !user) return;
    let unsubPartner: (() => void) | null = null;

    const unsubHousehold = onSnapshot(doc(db, 'households', householdId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setHousehold(data);
        setBudgetLimit(data.budgetSettings?.monthlyLimit?.toString() || '');
        setMonthlyIncomeInput(data.budgetSettings?.monthlyIncome?.toString() || '');

        const pid = data.memberIds?.find((id: string) => id !== user.uid);
        if (pid) {
          if (unsubPartner) unsubPartner();
          unsubPartner = onSnapshot(doc(db, 'users', pid), (pSnap) => {
            if (pSnap.exists()) setPartner({ id: pSnap.id, ...pSnap.data() });
          });
        } else {
          if (unsubPartner) unsubPartner();
          unsubPartner = null;
          setPartner(null);
        }
      }
    });

    return () => { unsubHousehold(); if (unsubPartner) unsubPartner(); };
  }, [householdId, user]);

  // ── Invite code ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || (household && household.memberIds?.length > 1)) return;

    const fetchInviteCode = async () => {
      const q = query(collection(db, 'inviteCodes'), where('createdBy', '==', user.uid), where('used', '==', false));
      const snap = await getDocs(q);
      let validCode: string | null = null;
      for (const d of snap.docs) {
        const c = d.data().code;
        if (/^\d{6}$/.test(c)) { validCode = c; }
        else { await deleteDoc(doc(db, 'inviteCodes', c)); }
      }
      if (validCode) {
        setInviteCode(validCode);
      } else {
        const newCode = Math.floor(100000 + Math.random() * 900000).toString();
        await setDoc(doc(db, 'inviteCodes', newCode), {
          code: newCode, createdBy: user.uid, householdId, used: false, createdAt: Timestamp.now(),
        });
        setInviteCode(newCode);
      }
    };
    fetchInviteCode();
  }, [user, household, householdId]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleUpdateName = async () => {
    if (!user || !tempName.trim()) { setIsEditingName(false); return; }
    await updateDoc(doc(db, 'users', user.uid), { displayName: tempName.trim() });
    setIsEditingName(false);
  };

  // personal dates (birthday) → user doc
  const handleUpdateUserDate = async (field: 'birthday', date: string) => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), { [field]: date });
  };

  // shared dates (togetherDate, weddingDate) → household doc
  const handleUpdateHouseholdDate = async (field: 'togetherDate' | 'weddingDate', date: string) => {
    if (!householdId) return;
    await updateDoc(doc(db, 'households', householdId), { [field]: date });
  };

  const handleUpdateBudget = async () => {
    if (!householdId || !budgetLimit) return;
    await updateDoc(doc(db, 'households', householdId), {
      'budgetSettings.monthlyLimit': parseFloat(budgetLimit),
    });
    setShowBudgetSheet(false);
  };

  const handleUpdateIncome = async () => {
    if (!householdId || !monthlyIncomeInput) return;
    await updateDoc(doc(db, 'households', householdId), {
      'budgetSettings.monthlyIncome': parseFloat(monthlyIncomeInput),
    });
    setShowIncomeSheet(false);
  };

  const togglePref = async (key: keyof NotificationPrefs) => {
    if (!user) return;
    const currentPrefs = userData?.notificationPrefs || {};
    await updateDoc(doc(db, 'users', user.uid), { [`notificationPrefs.${key}`]: !currentPrefs[key] });
  };

  const copyInviteCode = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const shareViaWhatsApp = () => {
    if (!inviteCode) return;
    const msg = `Hey! Join me on OurSpace 🏠 Use code: ${inviteCode}. Download at: ${window.location.origin}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const sendEmailInvite = async () => {
    if (!user || !partnerEmail || !householdId) return;
    setIsSendingInvite(true);
    try {
      await addDoc(collection(db, 'emailInvites'), {
        email: partnerEmail.toLowerCase().trim(),
        fromUid: user.uid,
        fromName: userData?.displayName || user.displayName || 'Your Partner',
        householdId,
        createdAt: Timestamp.now(),
      });
      setInviteSent(true);
      setPartnerEmail('');
      setTimeout(() => setInviteSent(false), 3000);
    } finally {
      setIsSendingInvite(false);
    }
  };

  const handleProfileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (fileInputRef.current) fileInputRef.current.value = '';
    setIsUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const storageRef = ref(storage, `users/${user.uid}/profile_${Date.now()}.${ext}`);
      await new Promise<void>((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, file);
        task.on('state_changed', null, reject, () => resolve());
      });
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, 'users', user.uid), { photoURL: url });
      await updateProfile(user, { photoURL: url });
    } catch (err: any) {
      const msg = err?.code === 'storage/unauthorized'
        ? 'Permission denied. Check Firebase Storage rules.'
        : err?.message || 'Upload failed.';
      alert(msg);
    } finally {
      setIsUploading(false);
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const togetherDate  = fmtDate(household?.togetherDate);
  const weddingDate   = fmtDate(household?.weddingDate);
  const myBirthday    = fmtDate(userData?.birthday);
  const partnerBday   = fmtDate(partner?.birthday);

  const slide = (delay: number) => ({
    initial: { opacity: 0, y: 28, filter: 'blur(4px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    transition: { duration: 0.45, delay },
  });

  return (
    <div
      style={{
        height: 'calc(100dvh - 76px)',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
        paddingBottom: 'calc(80px + env(safe-area-inset-bottom))',
        background: '#fcf9f4',
      }}
      className="no-scrollbar"
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-6 pt-16 pb-4 flex items-center gap-4 sticky top-0 bg-[#fcf9f4] z-10 border-b border-[#EDE8DF]">
        <button onClick={onBack} className="p-2 -ml-2 text-[#1A1A1A]">
          <ChevronLeft size={24} />
        </button>
        <h1 className="font-serif text-[32px] text-[#1A1A1A] leading-none">Settings</h1>
      </div>

      <div className="px-4 pb-12">

        {/* ── 1. YOUR PROFILE ──────────────────────────────────────────────── */}
        <motion.div {...slide(0)} className="mt-6 mb-2">
          <div className="p-6 bg-[#EDE8DF] rounded-[22px] border border-[#D4CEC4] flex flex-col items-center text-center">
            <div className="relative mb-4 group">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-[72px] h-[72px] rounded-full border-[3px] border-[#fcf9f4] overflow-hidden relative z-10 block"
              >
                {(userData?.photoURL || user?.photoURL) ? (
                  <img src={userData?.photoURL || user?.photoURL || ''} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full bg-[#B8955A] flex items-center justify-center font-serif text-2xl text-white">
                    {(userData?.displayName || user?.displayName || 'U')[0].toUpperCase()}
                  </div>
                )}
                {isUploading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  </div>
                )}
              </button>
              <div className="absolute bottom-0 right-0 w-7 h-7 bg-[#1A1A1A] rounded-full border-2 border-[#fcf9f4] z-20 flex items-center justify-center text-white shadow-lg pointer-events-none">
                <Camera size={12} />
              </div>
              <div className="absolute inset-[-5px] border-[2px] border-[#B8955A] rounded-full pointer-events-none" />
              <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleProfileUpload} />
            </div>

            {isEditingName ? (
              <div className="relative w-full max-w-[200px]">
                <input
                  ref={nameInputRef}
                  autoFocus
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onBlur={handleUpdateName}
                  onKeyDown={(e) => e.key === 'Enter' && handleUpdateName()}
                  className="w-full text-center font-serif text-[24px] text-[#1A1A1A] bg-transparent border-none outline-none"
                />
                <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-[#B8955A]" />
              </div>
            ) : (
              <h2 onClick={() => setIsEditingName(true)} className="font-serif text-[24px] text-[#1A1A1A] cursor-pointer">
                {userData?.displayName || user?.displayName}
              </h2>
            )}
            <p className="font-outfit text-[13px] text-[#6B6560] mt-1">{user?.email}</p>
          </div>
        </motion.div>

        {/* ── 2. PARTNER CARD ──────────────────────────────────────────────── */}
        {partner && (
          <motion.div {...slide(0.06)} className="mb-2">
            <div className="p-5 bg-[#EDE8DF] rounded-[22px] border border-[#D4CEC4] flex items-center gap-4">
              <div className="w-[52px] h-[52px] rounded-full overflow-hidden border border-[#D4CEC4] flex-shrink-0">
                {partner.photoURL
                  ? <img src={partner.photoURL} alt="Partner" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  : <div className="w-full h-full bg-[#B8955A]/20 flex items-center justify-center font-serif text-xl text-[#B8955A]">{(partner.displayName || '?')[0]}</div>
                }
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-serif text-[20px] text-[#1A1A1A]">{partner.displayName}</h2>
                  <div className={`w-2 h-2 rounded-full ${partner.online ? 'bg-[#7FAF7B]' : 'bg-[#D4CEC4]'}`} />
                </div>
                <p className="font-outfit text-[12px] text-[#6B6560]">
                  Your partner · {partner.email || 'linked'}
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── 3. INVITE PARTNER (solo) ──────────────────────────────────────── */}
        <AnimatePresence>
          {household && household.memberIds?.length === 1 && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              className="overflow-hidden"
            >
              <div className="p-6 bg-[#EDE8DF] rounded-[22px] border border-[#D4CEC4]">
                <h2 className="font-serif text-[20px] text-[#1A1A1A] mb-1">Invite your partner</h2>
                <p className="font-outfit text-[13px] text-[#6B6560] mb-5">Share this 6-digit code with your partner</p>

                <div className="flex items-center justify-center gap-2 mb-6">
                  <span className="font-serif text-[44px] text-[#1A1A1A] tracking-[10px]">{inviteCode?.substring(0, 3)}</span>
                  <span className="text-[#B8955A] text-[26px] leading-none">•</span>
                  <span className="font-serif text-[44px] text-[#1A1A1A] tracking-[10px]">{inviteCode?.substring(3)}</span>
                </div>

                <div className="flex gap-3 mb-4">
                  <button onClick={copyInviteCode} className="flex-1 h-11 rounded-full border border-[#D4CEC4] bg-[#fcf9f4] font-outfit text-[13px] text-[#1A1A1A] flex items-center justify-center gap-2">
                    {isCopied ? <span className="text-[#7FAF7B] flex items-center gap-1">Copied <Check size={13} /></span> : 'Copy code'}
                  </button>
                  <button onClick={shareViaWhatsApp} className="flex-1 h-11 rounded-full bg-[#25D366] font-outfit text-[13px] text-white flex items-center justify-center gap-2">
                    Share via WhatsApp
                  </button>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <input
                    type="email"
                    value={partnerEmail}
                    onChange={(e) => setPartnerEmail(e.target.value)}
                    placeholder="Or invite by email..."
                    className="flex-1 h-11 rounded-xl border border-[#D4CEC4] bg-white font-outfit text-[13px] text-[#1A1A1A] px-4 outline-none focus:border-[#B8955A]"
                  />
                  <button
                    onClick={sendEmailInvite}
                    disabled={!partnerEmail || isSendingInvite}
                    className="h-11 px-4 rounded-xl bg-[#1A1A1A] font-outfit text-[13px] text-white disabled:opacity-40"
                  >
                    {isSendingInvite ? '…' : inviteSent ? 'Sent!' : 'Send'}
                  </button>
                </div>

                <div className="flex items-center justify-center gap-2">
                  <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }}
                    className="w-2 h-2 rounded-full bg-[#B8955A]" />
                  <span className="font-outfit text-[12px] text-[#6B6560]">Waiting for your partner to join…</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 4. OUR STORY — shared dates ──────────────────────────────────── */}
        <motion.div {...slide(0.12)}>
          <SectionLabel>Our Story</SectionLabel>
          <div className="bg-[#fcf9f4] rounded-[16px] border border-[#D4CEC4] overflow-hidden">
            <div className="relative">
              <SettingsRow
                icon={Heart}
                label="Together Since"
                subtext={togetherDate || 'When did you first get together?'}
              />
              <input
                type="date"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => handleUpdateHouseholdDate('togetherDate', e.target.value)}
              />
            </div>
            <div className="relative" style={{ borderBottom: 'none' }}>
              <SettingsRow
                icon={CalendarHeart}
                label="Wedding Anniversary"
                subtext={weddingDate || 'When did you get married?'}
                showChevron={!!(!weddingDate)}
              />
              <input
                type="date"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => handleUpdateHouseholdDate('weddingDate', e.target.value)}
              />
            </div>
          </div>
          <p className="font-outfit text-[11px] text-[#6B6560] mt-1.5 px-1">
            Shared with your partner — both see the same dates.
          </p>
        </motion.div>

        {/* ── 5. BIRTHDAYS — personal ──────────────────────────────────────── */}
        <motion.div {...slide(0.16)}>
          <SectionLabel>Birthdays</SectionLabel>
          <div className="bg-[#fcf9f4] rounded-[16px] border border-[#D4CEC4] overflow-hidden">
            <div className="relative">
              <SettingsRow
                icon={Cake}
                label="Your Birthday"
                subtext={myBirthday || 'Set your birthday'}
              />
              <input
                type="date"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => handleUpdateUserDate('birthday', e.target.value)}
              />
            </div>
            {partner && (
              <div style={{ borderBottom: 'none' }}>
                <SettingsRow
                  icon={Gift}
                  label={`${(partner.displayName || 'Partner').split(' ')[0]}'s Birthday`}
                  subtext={partnerBday || 'Not set yet'}
                  showChevron={false}
                />
              </div>
            )}
          </div>
        </motion.div>

        {/* ── 6. INTEGRATIONS ──────────────────────────────────────────────── */}
        <motion.div {...slide(0.20)}>
          <SectionLabel>Integrations</SectionLabel>
          <div className="bg-[#fcf9f4] rounded-[16px] border border-[#D4CEC4] overflow-hidden">
            <SettingsRow
              icon={Globe}
              label="Google Calendar"
              subtext={userData?.calendarConnected ? (userData.calendarEmail || 'Connected') : 'Not linked'}
              rightElement={
                userData?.calendarConnected ? (
                  <button onClick={(e) => { e.stopPropagation(); clearGoogleToken(); }}
                    className="text-[11px] font-outfit font-semibold text-[#C97B6A] px-3 py-1 bg-[#F5E6E0] rounded-full">
                    Disconnect
                  </button>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); connectGoogleCalendar(); }}
                    className="text-[11px] font-outfit font-semibold text-[#B8955A] px-3 py-1 bg-[#EDE8DF] rounded-full">
                    Connect
                  </button>
                )
              }
              showChevron={false}
            />
            {partner && (
              <div style={{ borderBottom: 'none' }}>
                <SettingsRow
                  icon={LinkIcon}
                  label={`${(partner.displayName || 'Partner').split(' ')[0]}'s Calendar`}
                  subtext={partner.calendarConnected ? 'Connected' : 'Not connected'}
                  showChevron={false}
                  rightElement={<div className={`w-2 h-2 rounded-full ${partner.calendarConnected ? 'bg-[#7FAF7B]' : 'bg-[#D4CEC4]'}`} />}
                />
              </div>
            )}
          </div>
        </motion.div>

        {/* ── 7. FINANCES ──────────────────────────────────────────────────── */}
        <motion.div {...slide(0.24)}>
          <SectionLabel>Finances</SectionLabel>
          <div className="bg-[#fcf9f4] rounded-[16px] border border-[#D4CEC4] overflow-hidden">
            <SettingsRow
              icon={Wallet}
              label="Monthly Budget"
              subtext={household?.budgetSettings?.monthlyLimit
                ? `$${household.budgetSettings.monthlyLimit.toLocaleString()} / month`
                : 'Not set — tap to add'}
              onClick={() => setShowBudgetSheet(true)}
            />
            <div style={{ borderBottom: 'none' }}>
              <SettingsRow
                icon={DollarSign}
                label="Monthly Income"
                subtext={household?.budgetSettings?.monthlyIncome
                  ? `$${household.budgetSettings.monthlyIncome.toLocaleString()} / month`
                  : 'Not set — tap to add'}
                onClick={() => setShowIncomeSheet(true)}
              />
            </div>
          </div>
          <p className="font-outfit text-[11px] text-[#6B6560] mt-1.5 px-1">
            Used to calculate cash flow and savings rate.
          </p>
        </motion.div>

        {/* ── 8. NOTIFICATIONS ─────────────────────────────────────────────── */}
        <motion.div {...slide(0.28)}>
          <SectionLabel>Notifications</SectionLabel>
          <div className="bg-[#fcf9f4] rounded-[16px] border border-[#D4CEC4] overflow-hidden">
            <SettingsRow
              icon={Users}
              label="Partner activity"
              subtext="When partner adds or updates lists"
              showChevron={false}
              rightElement={<ToggleSwitch active={!!userData?.notificationPrefs?.partnerActivity} onToggle={() => togglePref('partnerActivity')} />}
            />
            <SettingsRow
              icon={Calendar}
              label="Event reminders"
              subtext="Upcoming events and dates"
              showChevron={false}
              rightElement={<ToggleSwitch active={!!userData?.notificationPrefs?.eventReminders} onToggle={() => togglePref('eventReminders')} />}
            />
            <SettingsRow
              icon={Heart}
              label="Relationship alerts"
              subtext="Insights and nudges"
              showChevron={false}
              rightElement={<ToggleSwitch active={!!userData?.notificationPrefs?.relationshipAlerts} onToggle={() => togglePref('relationshipAlerts')} />}
            />
            <SettingsRow
              icon={FileText}
              label="Weekly summary"
              subtext="Your week in review"
              showChevron={false}
              rightElement={<ToggleSwitch active={!!userData?.notificationPrefs?.weeklySummary} onToggle={() => togglePref('weeklySummary')} />}
            />
            <div style={{ borderBottom: 'none' }}>
              <SettingsRow
                icon={CalendarHeart}
                label="Anniversary reminders"
                subtext="Countdown to your special days"
                showChevron={false}
                rightElement={<ToggleSwitch active={!!userData?.notificationPrefs?.anniversaryReminders} onToggle={() => togglePref('anniversaryReminders')} />}
              />
            </div>
          </div>
        </motion.div>

        {/* ── 9. APP ───────────────────────────────────────────────────────── */}
        <motion.div {...slide(0.32)}>
          <SectionLabel>App</SectionLabel>
          <div className="bg-[#fcf9f4] rounded-[16px] border border-[#D4CEC4] overflow-hidden">
            <SettingsRow
              icon={Download}
              label="Install on home screen"
              subtext="Add to your phone's home screen"
              onClick={() => window.dispatchEvent(new Event('trigger-pwa-install'))}
            />
            <SettingsRow
              icon={Share2}
              label="Invite a friend"
              subtext="Share OurSpace with someone"
              onClick={shareViaWhatsApp}
            />
            <SettingsRow
              icon={Shield}
              label="Privacy Policy"
              onClick={() => window.open('https://ourspace.app/privacy', '_blank')}
            />
            <div style={{ borderBottom: 'none' }}>
              <SettingsRow
                icon={FileText}
                label="Terms of Service"
                onClick={() => window.open('https://ourspace.app/terms', '_blank')}
              />
            </div>
          </div>
        </motion.div>

        {/* ── 10. SIGN OUT ─────────────────────────────────────────────────── */}
        <motion.div {...slide(0.36)} className="mt-6">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowSignOutSheet(true)}
            className="w-full h-[52px] bg-[#F5E6E0] border border-[#C97B6A] rounded-[16px] font-outfit text-[15px] text-[#C97B6A] flex items-center justify-center gap-2"
          >
            <Trash2 size={16} />
            Sign Out
          </motion.button>
        </motion.div>

      </div>

      {/* ── Budget Sheet ──────────────────────────────────────────────────── */}
      <BottomSheet isOpen={showBudgetSheet} onClose={() => setShowBudgetSheet(false)}
        footer={
          <button onClick={handleUpdateBudget} className="w-full h-14 bg-[#1A1A1A] text-white rounded-[16px] font-outfit font-medium">
            Save Budget
          </button>
        }
      >
        <div className="px-2 py-4">
          <h2 className="font-serif text-[24px] text-[#1A1A1A] mb-1">Monthly Budget</h2>
          <p className="font-outfit text-[13px] text-[#6B6560] mb-6">Your total household spending limit per month.</p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-outfit text-[18px] text-[#1A1A1A]">$</span>
            <input
              type="number"
              value={budgetLimit}
              onChange={(e) => setBudgetLimit(e.target.value)}
              placeholder="0"
              className="w-full h-14 pl-10 pr-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-[16px] font-outfit text-[18px] text-[#1A1A1A] outline-none focus:border-[#B8955A]"
            />
          </div>
        </div>
      </BottomSheet>

      {/* ── Income Sheet ─────────────────────────────────────────────────── */}
      <BottomSheet isOpen={showIncomeSheet} onClose={() => setShowIncomeSheet(false)}
        footer={
          <button onClick={handleUpdateIncome} className="w-full h-14 bg-[#1A1A1A] text-white rounded-[16px] font-outfit font-medium">
            Save Income
          </button>
        }
      >
        <div className="px-2 py-4">
          <h2 className="font-serif text-[24px] text-[#1A1A1A] mb-1">Monthly Income</h2>
          <p className="font-outfit text-[13px] text-[#6B6560] mb-6">Your combined household take-home pay per month. Used to calculate savings rate and cash flow.</p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-outfit text-[18px] text-[#1A1A1A]">$</span>
            <input
              type="number"
              value={monthlyIncomeInput}
              onChange={(e) => setMonthlyIncomeInput(e.target.value)}
              placeholder="0"
              className="w-full h-14 pl-10 pr-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-[16px] font-outfit text-[18px] text-[#1A1A1A] outline-none focus:border-[#B8955A]"
            />
          </div>
        </div>
      </BottomSheet>

      {/* ── Sign-out Sheet ────────────────────────────────────────────────── */}
      <BottomSheet isOpen={showSignOutSheet} onClose={() => setShowSignOutSheet(false)}>
        <div className="px-2 py-4 text-center">
          <h2 className="font-serif text-[24px] text-[#1A1A1A] mb-2">Sign out?</h2>
          <p className="font-outfit text-[13px] text-[#6B6560] mb-8">You can sign back in anytime with your Google account.</p>
          <div className="flex flex-col gap-3">
            <button onClick={() => auth.signOut()} className="w-full h-14 bg-[#C97B6A] text-white rounded-[16px] font-outfit font-medium">
              Sign Out
            </button>
            <button onClick={() => setShowSignOutSheet(false)} className="w-full h-14 bg-transparent text-[#1A1A1A] rounded-[16px] font-outfit">
              Cancel
            </button>
          </div>
        </div>
      </BottomSheet>

    </div>
  );
}
