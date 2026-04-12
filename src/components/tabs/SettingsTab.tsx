import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
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
  Check,
  Globe,
  Link as LinkIcon
} from 'lucide-react';
import { doc, updateDoc, onSnapshot, collection, query, where, getDocs, addDoc, setDoc, Timestamp, deleteDoc } from 'firebase/firestore';
import { format } from 'date-fns';
import { db, auth } from '../../firebase';
import { useAuth } from '../AuthWrapper';
import { NotificationPrefs } from '../../services/notificationService';
import BottomSheet from '../ui/BottomSheet';

// --- Components ---

const SettingsRow = ({ 
  icon: Icon, 
  label, 
  subtext, 
  onClick, 
  rightElement,
  showChevron = true 
}: { 
  icon: any, 
  label: string, 
  subtext?: string, 
  onClick?: () => void,
  rightElement?: React.ReactNode,
  showChevron?: boolean
}) => (
  <motion.div
    whileTap={{ scale: 0.98, background: "#EDE8DF" }}
    transition={{ type: "spring", stiffness: 400, damping: 22 }}
    onClick={onClick}
    style={{
      display: "flex",
      alignItems: "center",
      gap: "16px",
      padding: "0 20px",
      height: "56px",
      background: "#F8F4EE",
      borderBottom: "1px solid #D4CEC4",
      cursor: "pointer"
    }}
  >
    <Icon size={22} color="#B8955A" />
    <div style={{ flex: 1 }}>
      <p style={{ fontFamily: "'Outfit'", fontSize: "14px", color: "#1A1A1A", margin: 0 }}>
        {label}
      </p>
      {subtext && (
        <p style={{ fontFamily: "'Outfit'", fontSize: "12px", color: "#6B6560", margin: 0 }}>
          {subtext}
        </p>
      )}
    </div>
    {rightElement || (showChevron && <ChevronRight size={16} color="#D4CEC4" />)}
  </motion.div>
);

const ToggleSwitch = ({ active, onToggle }: { active: boolean, onToggle: () => void }) => (
  <motion.div
    onClick={(e) => {
      e.stopPropagation();
      onToggle();
    }}
    animate={{ backgroundColor: active ? "#1A1A1A" : "#D4CEC4" }}
    style={{
      width: "44px",
      height: "26px",
      borderRadius: "999px",
      position: "relative",
      cursor: "pointer",
      padding: "3px"
    }}
  >
    <motion.div
      animate={{ x: active ? 18 : 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      style={{
        width: "20px",
        height: "20px",
        borderRadius: "50%",
        background: "white"
      }}
    />
  </motion.div>
);

const SectionLabel = ({ children }: { children: string }) => (
  <h3 style={{ 
    fontFamily: "'Outfit'", 
    fontSize: "12px", 
    fontWeight: 600, 
    letterSpacing: "0.1em", 
    color: "#B8955A", 
    textTransform: "uppercase",
    margin: "24px 20px 8px"
  }}>
    {children}
  </h3>
);

// --- Main Component ---

export default function SettingsTab({ onBack }: { onBack: () => void }) {
  const { user, userData, householdId, googleAccessToken, connectGoogleCalendar, clearGoogleToken } = useAuth();
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(userData?.displayName || user?.displayName || "");
  const [partner, setPartner] = useState<any>(null);
  const [household, setHousehold] = useState<any>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [showBudgetSheet, setShowBudgetSheet] = useState(false);
  const [showSignOutSheet, setShowSignOutSheet] = useState(false);
  const [budgetLimit, setBudgetLimit] = useState("");
  const [partnerEmail, setPartnerEmail] = useState("");
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Listen to household and partner
  useEffect(() => {
    if (!householdId || !user) return;

    let unsubPartner: (() => void) | null = null;

    const unsubHousehold = onSnapshot(doc(db, 'households', householdId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setHousehold(data);
        setBudgetLimit(data.budgetSettings?.monthlyLimit?.toString() || "");

        const partnerId = data.memberIds?.find((id: string) => id !== user.uid);
        if (partnerId) {
          if (unsubPartner) unsubPartner();
          unsubPartner = onSnapshot(doc(db, 'users', partnerId), (pSnap) => {
            if (pSnap.exists()) {
              setPartner({ id: pSnap.id, ...pSnap.data() });
            }
          });
        } else {
          if (unsubPartner) unsubPartner();
          unsubPartner = null;
          setPartner(null);
        }
      }
    });

    return () => {
      unsubHousehold();
      if (unsubPartner) unsubPartner();
    };
  }, [householdId, user]);

  // Handle Invite Code
  useEffect(() => {
    if (!user || (household && household.memberIds?.length > 1)) return;

    const fetchInviteCode = async () => {
      const q = query(
        collection(db, 'inviteCodes'),
        where('createdBy', '==', user.uid),
        where('used', '==', false)
      );
      const snapshot = await getDocs(q);
      
      let validCode = null;
      for (const d of snapshot.docs) {
        const c = d.data().code;
        if (/^\d{6}$/.test(c)) {
          validCode = c;
        } else {
          // Delete old alphanumeric legacy codes
          await deleteDoc(doc(db, 'inviteCodes', c));
        }
      }

      if (validCode) {
        setInviteCode(validCode);
      } else {
        // Generate new 6-digit number code
        const newCode = Math.floor(100000 + Math.random() * 900000).toString();
        await setDoc(doc(db, 'inviteCodes', newCode), {
          code: newCode,
          createdBy: user.uid,
          householdId: householdId,
          used: false,
          createdAt: Timestamp.now()
        });
        setInviteCode(newCode);
      }
    };

    fetchInviteCode();
  }, [user, household, householdId]);

  const handleUpdateName = async () => {
    if (!user || !tempName.trim()) {
      setIsEditingName(false);
      return;
    }
    await updateDoc(doc(db, 'users', user.uid), {
      displayName: tempName.trim()
    });
    setIsEditingName(false);
  };

  const handleUpdateDate = async (field: 'anniversary' | 'birthday', date: string) => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid), {
      [field]: date
    });
  };

  const handleUpdateBudget = async () => {
    if (!householdId || !budgetLimit) return;
    await updateDoc(doc(db, 'households', householdId), {
      'budgetSettings.monthlyLimit': parseFloat(budgetLimit)
    });
    setShowBudgetSheet(false);
  };

  const togglePref = async (key: keyof NotificationPrefs) => {
    if (!user) return;
    const currentPrefs = userData?.notificationPrefs || {};
    await updateDoc(doc(db, 'users', user.uid), {
      [`notificationPrefs.${key}`]: !currentPrefs[key]
    });
  };

  const copyInviteCode = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(inviteCode);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const shareViaWhatsApp = () => {
    if (!inviteCode) return;
    const message = `Hey! Join me on OurSpace 🏠 Use code: ${inviteCode} to link up with me. Download at: ${window.location.origin}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  const sendEmailInvite = async () => {
    if (!user || !partnerEmail || !householdId) return;
    setIsSendingInvite(true);
    try {
      await addDoc(collection(db, 'emailInvites'), {
        email: partnerEmail.toLowerCase().trim(),
        fromUid: user.uid,
        fromName: userData?.displayName || user.displayName || 'Your Partner',
        householdId: householdId,
        createdAt: Timestamp.now()
      });
      setInviteSent(true);
      setPartnerEmail("");
      setTimeout(() => setInviteSent(false), 3000);
    } catch (error) {
      console.error('Failed to send invite:', error);
    } finally {
      setIsSendingInvite(false);
    }
  };

  const handleSignOut = () => {
    auth.signOut();
  };

  const sections = [
    { id: 'profile', delay: 0 },
    { id: 'partner', delay: 80 },
    { id: 'invite', delay: 160 },
    { id: 'dates', delay: 240 },
    { id: 'finances', delay: 320 },
    { id: 'notifications', delay: 400 },
    { id: 'app', delay: 480 },
    { id: 'signout', delay: 560 },
  ];

  return (
    <div 
      style={{
        height: "calc(100dvh - 80px)",
        overflowY: "auto",
        overflowX: "hidden",
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        paddingBottom: "calc(80px + env(safe-area-inset-bottom))",
        background: "#F8F4EE"
      }}
      className="settings-container no-scrollbar"
    >
      {/* Header */}
      <div className="px-6 pt-16 pb-6 flex items-center gap-4 sticky top-0 bg-[#F8F4EE] z-10">
        <button onClick={onBack} className="p-2 -ml-2 text-[#1A1A1A]">
          <ChevronLeft size={24} />
        </button>
        <h1 className="font-serif text-[32px] text-[#1A1A1A] leading-none">Settings</h1>
      </div>

      <div className="px-5 pb-12">
        {/* Section 1: Your Profile */}
        <motion.div
          initial={{ opacity: 0, y: 32, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.5, delay: 0 }}
          className="mb-8 p-6 bg-[#EDE8DF] rounded-[20px] border border-[#D4CEC4] flex flex-col items-center text-center"
        >
          <div className="relative mb-4">
            <div className="w-[72px] h-[72px] rounded-full border-[3px] border-[#F8F4EE] overflow-hidden relative z-10">
              <img 
                src={user?.photoURL || ''} 
                alt="Profile" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="absolute inset-[-5px] border-[2px] border-[#B8955A] rounded-full" />
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
              <motion.div 
                layoutId="nameUnderline"
                className="absolute bottom-0 left-0 right-0 h-[1px] bg-[#B8955A]" 
              />
            </div>
          ) : (
            <h2 
              onClick={() => setIsEditingName(true)}
              className="font-serif text-[24px] text-[#1A1A1A] cursor-pointer"
            >
              {userData?.displayName || user?.displayName}
            </h2>
          )}
          <p className="font-outfit text-[14px] text-[#6B6560] mt-1">{user?.email}</p>
        </motion.div>

        {/* Section 2: Your Partner */}
        {partner && (
          <motion.div
            initial={{ opacity: 0, y: 32, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="mb-8 p-6 bg-[#EDE8DF] rounded-[20px] border border-[#D4CEC4] flex items-center gap-4"
          >
            <div className="w-[56px] h-[56px] rounded-full overflow-hidden border border-[#D4CEC4]">
              <img 
                src={partner.photoURL || ''} 
                alt="Partner" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-[20px] text-[#1A1A1A]">{partner.displayName}</h2>
                <div 
                  className={`w-2 h-2 rounded-full ${partner.online ? 'bg-[#7FAF7B]' : 'bg-[#D4CEC4]'}`} 
                />
              </div>
              <p className="font-outfit text-[13px] text-[#6B6560]">
                Linked since {household?.createdAt ? format(new Date(household.createdAt), 'MMM d, yyyy') : '...'}
              </p>
            </div>
          </motion.div>
        )}

        {/* Invite Partner Section */}
        <AnimatePresence>
          {household && household.memberIds?.length === 1 && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: 32 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              className="overflow-hidden"
            >
              <div className="p-6 bg-[#EDE8DF] rounded-[20px] border border-[#D4CEC4]">
                <h2 className="font-serif text-[20px] text-[#1A1A1A] mb-1">Invite your partner</h2>
                <p className="font-outfit text-[14px] text-[#6B6560] mb-6">
                  Share this code with your partner so they can join
                </p>

                <div className="flex items-center justify-center gap-2 mb-8">
                  <span className="font-serif text-[42px] text-[#1A1A1A] tracking-[8px]">
                    {inviteCode?.substring(0, 3)}
                  </span>
                  <span className="text-[#B8955A] text-[24px]">•</span>
                  <span className="font-serif text-[42px] text-[#1A1A1A] tracking-[8px]">
                    {inviteCode?.substring(3)}
                  </span>
                </div>

                <div className="flex gap-3 mb-6">
                  <button 
                    onClick={copyInviteCode}
                    className="flex-1 h-11 rounded-full border border-[#D4CEC4] bg-[#EDE8DF] font-outfit text-[14px] text-[#1A1A1A] flex items-center justify-center gap-2"
                  >
                    {isCopied ? (
                      <span className="text-[#7FAF7B] flex items-center gap-1">
                        Copied <Check size={14} />
                      </span>
                    ) : (
                      "Copy code"
                    )}
                  </button>
                  <button 
                    onClick={shareViaWhatsApp}
                    className="flex-1 h-11 rounded-full bg-[#25D366] font-outfit text-[14px] text-white flex items-center justify-center gap-2"
                  >
                    Share via WhatsApp
                  </button>
                </div>

                <div className="mb-6 relative">
                  <div className="flex items-center gap-2">
                    <input 
                      type="email"
                      value={partnerEmail}
                      onChange={(e) => setPartnerEmail(e.target.value)}
                      placeholder="Or invite by email address..."
                      className="flex-1 h-11 rounded-xl border border-[#D4CEC4] bg-white font-outfit text-[14px] text-[#1A1A1A] px-4 outline-none focus:border-[#B8955A]"
                    />
                    <button
                      onClick={sendEmailInvite}
                      disabled={!partnerEmail || isSendingInvite}
                      className="h-11 px-4 rounded-xl bg-[#1A1A1A] font-outfit text-[14px] text-white flex items-center justify-center disabled:opacity-50"
                    >
                      {isSendingInvite ? '...' : inviteSent ? 'Sent!' : 'Send'}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-2">
                  <motion.div 
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="w-2 h-2 rounded-full bg-[#B8955A]"
                  />
                  <span className="font-outfit text-[13px] text-[#6B6560]">
                    Waiting for your partner to join...
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Section 3: Important Dates */}
        <motion.div
          initial={{ opacity: 0, y: 32, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.5, delay: 0.24 }}
        >
          <SectionLabel>Important Dates</SectionLabel>
          <div className="bg-[#F8F4EE] rounded-[16px] border border-[#D4CEC4] overflow-hidden">
            <div className="relative">
              <SettingsRow 
                icon={CalendarHeart}
                label="Anniversary"
                subtext={userData?.anniversary ? format(new Date(userData.anniversary), 'MMMM d, yyyy') : 'Set date'}
              />
              <input 
                type="date"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => handleUpdateDate('anniversary', e.target.value)}
              />
            </div>
            <div className="relative">
              <SettingsRow 
                icon={CalendarHeart}
                label="Your birthday"
                subtext={userData?.birthday ? format(new Date(userData.birthday), 'MMMM d, yyyy') : 'Set date'}
              />
              <input 
                type="date"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => handleUpdateDate('birthday', e.target.value)}
              />
            </div>
          </div>
        </motion.div>

        {/* Section: Integrations */}
        <motion.div
          initial={{ opacity: 0, y: 32, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.5, delay: 0.28 }}
        >
          <SectionLabel>Integrations</SectionLabel>
          <div className="bg-[#F8F4EE] rounded-[16px] border border-[#D4CEC4] overflow-hidden">
            <SettingsRow 
              icon={Globe}
              label="Google Calendar"
              subtext={userData?.calendarConnected ? (userData.calendarEmail || "Connected") : "Not linked"}
              rightElement={
                userData?.calendarConnected ? (
                  <button 
                    onClick={(e) => { e.stopPropagation(); clearGoogleToken(); }}
                    className="text-[12px] font-outfit font-medium text-[#C97B6A] px-3 py-1 bg-[#F5E6E0] rounded-full"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button 
                    onClick={(e) => { e.stopPropagation(); connectGoogleCalendar(); }}
                    className="text-[12px] font-outfit font-medium text-[#B8955A] px-3 py-1 bg-[#EDE8DF] rounded-full"
                  >
                    Connect
                  </button>
                )
              }
              showChevron={false}
            />
            {partner && (
              <SettingsRow 
                icon={LinkIcon}
                label={`${partner.displayName}'s Sync`}
                subtext={partner.calendarConnected ? "Connected" : "Not connected"}
                showChevron={false}
                rightElement={
                  <div className={`w-2 h-2 rounded-full ${partner.calendarConnected ? 'bg-[#7FAF7B]' : 'bg-[#D4CEC4]'}`} />
                }
              />
            )}
          </div>
        </motion.div>

        {/* Section 4: Budget */}
        <motion.div
          initial={{ opacity: 0, y: 32, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.5, delay: 0.32 }}
        >
          <SectionLabel>Finances</SectionLabel>
          <div className="bg-[#F8F4EE] rounded-[16px] border border-[#D4CEC4] overflow-hidden">
            <SettingsRow 
              icon={Wallet}
              label="Monthly Budget"
              subtext={household?.budgetSettings?.monthlyLimit ? `$${household.budgetSettings.monthlyLimit}` : 'Not set'}
              onClick={() => setShowBudgetSheet(true)}
            />
          </div>
        </motion.div>

        {/* Section 5: Notifications */}
        <motion.div
          initial={{ opacity: 0, y: 32, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <SectionLabel>Notifications</SectionLabel>
          <div className="bg-[#F8F4EE] rounded-[16px] border border-[#D4CEC4] overflow-hidden">
            <SettingsRow 
              icon={ShoppingCart}
              label="Partner activity"
              subtext="When partner adds to lists or notes"
              showChevron={false}
              rightElement={<ToggleSwitch active={!!userData?.notificationPrefs?.partnerActivity} onToggle={() => togglePref('partnerActivity')} />}
            />
            <SettingsRow 
              icon={Calendar}
              label="Event reminders"
              subtext="Upcoming events and reminders"
              showChevron={false}
              rightElement={<ToggleSwitch active={!!userData?.notificationPrefs?.eventReminders} onToggle={() => togglePref('eventReminders')} />}
            />
            <SettingsRow 
              icon={Shield}
              label="Relationship alerts"
              subtext="Proactive insights and alerts"
              showChevron={false}
              rightElement={<ToggleSwitch active={!!userData?.notificationPrefs?.relationshipAlerts} onToggle={() => togglePref('relationshipAlerts')} />}
            />
            <SettingsRow 
              icon={FileText}
              label="Weekly summary"
              subtext="When your week in review is ready"
              showChevron={false}
              rightElement={<ToggleSwitch active={!!userData?.notificationPrefs?.weeklySummary} onToggle={() => togglePref('weeklySummary')} />}
            />
            <SettingsRow 
              icon={CalendarHeart}
              label="Anniversary reminders"
              subtext="Countdown to your special days"
              showChevron={false}
              rightElement={<ToggleSwitch active={!!userData?.notificationPrefs?.anniversaryReminders} onToggle={() => togglePref('anniversaryReminders')} />}
            />
          </div>
        </motion.div>

        {/* Section 6: App */}
        <motion.div
          initial={{ opacity: 0, y: 32, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.5, delay: 0.48 }}
        >
          <SectionLabel>App</SectionLabel>
          <div className="bg-[#F8F4EE] rounded-[16px] border border-[#D4CEC4] overflow-hidden">
            <SettingsRow 
              icon={Download}
              label="Install on home screen"
              onClick={() => {
                // Trigger PWA prompt logic from App.tsx via window event or similar
                window.dispatchEvent(new Event('trigger-pwa-install'));
              }}
            />
            <SettingsRow 
              icon={Share2}
              label="Share invite link"
              onClick={shareViaWhatsApp}
            />
            <SettingsRow 
              icon={Shield}
              label="Privacy Policy"
              onClick={() => window.open('https://ourspace.app/privacy', '_blank')}
            />
            <SettingsRow 
              icon={FileText}
              label="Terms of Service"
              onClick={() => window.open('https://ourspace.app/terms', '_blank')}
            />
          </div>
        </motion.div>

        {/* Section 7: Sign Out */}
        <motion.div
          initial={{ opacity: 0, y: 32, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.5, delay: 0.56 }}
          className="mt-8"
        >
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowSignOutSheet(true)}
            className="w-full h-[52px] bg-[#F5E6E0] border border-[#C97B6A] rounded-[16px] font-outfit text-[15px] text-[#C97B6A] flex items-center justify-center"
          >
            Sign Out
          </motion.button>
        </motion.div>
      </div>

      {/* Budget Bottom Sheet */}
      <BottomSheet isOpen={showBudgetSheet} onClose={() => setShowBudgetSheet(false)}>
        <div className="p-6">
          <h2 className="font-serif text-[24px] text-[#1A1A1A] mb-2">Monthly Budget</h2>
          <p className="font-outfit text-[14px] text-[#6B6560] mb-6">Set a monthly spending limit for your household.</p>
          
          <div className="relative mb-8">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-outfit text-[18px] text-[#1A1A1A]">$</span>
            <input 
              type="number"
              value={budgetLimit}
              onChange={(e) => setBudgetLimit(e.target.value)}
              placeholder="0.00"
              className="w-full h-14 pl-10 pr-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-[16px] font-outfit text-[18px] text-[#1A1A1A] outline-none focus:border-[#B8955A]"
            />
          </div>

          <button 
            onClick={handleUpdateBudget}
            className="w-full h-14 bg-[#1A1A1A] text-white rounded-[16px] font-outfit font-medium"
          >
            Save Limit
          </button>
        </div>
      </BottomSheet>

      {/* Sign Out Confirmation */}
      <BottomSheet isOpen={showSignOutSheet} onClose={() => setShowSignOutSheet(false)}>
        <div className="p-6 text-center">
          <h2 className="font-serif text-[24px] text-[#1A1A1A] mb-2">Are you sure?</h2>
          <p className="font-outfit text-[14px] text-[#6B6560] mb-8">You will be signed out of your account.</p>
          
          <div className="flex flex-col gap-3">
            <button 
              onClick={handleSignOut}
              className="w-full h-14 bg-[#C97B6A] text-white rounded-[16px] font-outfit font-medium"
            >
              Sign Out
            </button>
            <button 
              onClick={() => setShowSignOutSheet(false)}
              className="w-full h-14 bg-transparent text-[#1A1A1A] rounded-[16px] font-outfit"
            >
              Cancel
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
