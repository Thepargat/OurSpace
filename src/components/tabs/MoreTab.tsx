import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard, Wrench, ActivitySquare, ShoppingCart, Utensils,
  Brush, StickyNote, PiggyBank, Settings, ChevronDown, Heart,
  User, Bell, Palette, Lock,
} from 'lucide-react';
import PageTransition from '../ui/PageTransition';
import { useAuth } from '../AuthWrapper';

const GOLD = '#B8955A';
const GOLD_LIGHT = `${GOLD}18`;

// ── Icon colour palette per section ─────────────────────────────────────────
const SECTION_PALETTE: Record<string, { bg: string; fg: string }> = {
  settings:       { bg: '#1A1A1A18', fg: '#1A1A1A' },
  'daily-life':   { bg: '#5B68E818', fg: '#5B68E8' },
  'money-home':   { bg: `${GOLD}22`, fg: GOLD },
  'you-partner':  { bg: '#E17B9B22', fg: '#E17B9B' },
};

// ── Settings quick-access items ─────────────────────────────────────────────
const SETTINGS_ITEMS = [
  { id: 'settings',   name: 'Profile & Account',  subtitle: 'Edit name, photo, preferences', icon: User },
  { id: 'settings',   name: 'Notifications',       subtitle: 'Choose what alerts you get',    icon: Bell },
  { id: 'settings',   name: 'Appearance',          subtitle: 'Theme, colours, layout',        icon: Palette },
  { id: 'settings',   name: 'Privacy & Security',  subtitle: 'Manage your data & access',    icon: Lock },
];

// ── Main menu sections ────────────────────────────────────────────────────────
const MENU_SECTIONS = [
  {
    id: 'daily-life',
    heading: 'Daily Life',
    emoji: '🏠',
    defaultOpen: true,
    items: [
      { id: 'grocery',      name: 'Grocery List',    subtitle: 'Your shared shopping list',    icon: ShoppingCart },
      { id: 'meal-planner', name: 'Meal Planner',    subtitle: 'Plan your week together',      icon: Utensils },
      { id: 'chores',       name: 'Chores',          subtitle: 'Keep the home running',        icon: Brush },
      { id: 'notes',        name: 'Shared Notes',    subtitle: 'One note, two people',         icon: StickyNote },
    ],
  },
  {
    id: 'money-home',
    heading: 'Money & Home',
    emoji: '💰',
    defaultOpen: false,
    items: [
      { id: 'subscriptions', name: 'Subscriptions',  subtitle: 'Track recurring charges',      icon: CreditCard },
      { id: 'home-car',      name: 'Home & Car',     subtitle: 'Maintenance tracker',          icon: Wrench },
      { id: 'savings',       name: 'Savings Goals',  subtitle: 'Working toward something',     icon: PiggyBank },
    ],
  },
  {
    id: 'you-partner',
    heading: 'You & Partner',
    emoji: '❤️',
    defaultOpen: false,
    items: [
      { id: 'activity',     name: 'Activity Feed',   subtitle: 'See everything happening',    icon: ActivitySquare },
      { id: 'mood-history', name: 'Mood History',    subtitle: 'Track your vibes over time',  icon: Heart },
    ],
  },
];

// ── Row animation ─────────────────────────────────────────────────────────────
const rowVariants = {
  hidden: { opacity: 0, x: -10, height: 0 },
  show: (i: number) => ({
    opacity: 1, x: 0, height: 'auto',
    transition: { type: 'spring' as const, stiffness: 320, damping: 26, delay: i * 0.04 },
  }),
  exit: { opacity: 0, x: -8, height: 0, transition: { duration: 0.18 } },
};

// ── Menu Row ─────────────────────────────────────────────────────────────────
function MenuRow({
  item, palette, index, onNavigate,
}: {
  item: { id: string; name: string; subtitle: string; icon: any };
  palette: { bg: string; fg: string };
  index: number;
  onNavigate: (id: string) => void;
}) {
  const Icon = item.icon;
  return (
    <motion.div
      custom={index}
      variants={rowVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      style={{ overflow: 'hidden' }}
    >
      <motion.button
        onClick={() => onNavigate(item.id)}
        whileTap={{ scale: 0.98, backgroundColor: '#f5f1eb' }}
        className="flex items-center h-[60px] w-full text-left px-4 bg-white border-b border-black/[0.04] last:border-b-0 transition-colors"
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mr-3"
          style={{ background: palette.bg }}
        >
          <Icon size={17} color={palette.fg} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[13.5px] text-[#1A1A1A] leading-snug">{item.name}</div>
          <div className="text-[11.5px] text-[#6B6560] leading-snug">{item.subtitle}</div>
        </div>
        <ChevronDown
          size={14}
          color={`${GOLD}80`}
          className="flex-shrink-0 ml-2 -rotate-90"
        />
      </motion.button>
    </motion.div>
  );
}

// ── Collapsible Section ───────────────────────────────────────────────────────
function AccordionSection({
  section, onNavigate,
}: {
  section: typeof MENU_SECTIONS[number];
  onNavigate: (id: string) => void;
}) {
  const [open, setOpen] = useState(section.defaultOpen);
  const palette = SECTION_PALETTE[section.id] || { bg: GOLD_LIGHT, fg: GOLD };

  return (
    <motion.div
      layout
      className="bg-white border border-black/[0.06] rounded-2xl overflow-hidden shadow-sm"
    >
      {/* Header toggle */}
      <motion.button
        onClick={() => setOpen((v) => !v)}
        whileTap={{ scale: 0.99 }}
        className="flex items-center w-full h-[52px] px-4 bg-white"
      >
        <span className="text-[16px] mr-2.5 leading-none">{section.emoji}</span>
        <span className="font-medium text-[12px] uppercase tracking-[2px] flex-1 text-left" style={{ color: GOLD }}>
          {section.heading}
        </span>
        <motion.div
          animate={{ rotate: open ? 0 : -90 }}
          transition={{ type: 'spring', stiffness: 350, damping: 28 }}
        >
          <ChevronDown size={16} color={`${GOLD}80`} />
        </motion.div>
      </motion.button>

      {/* Items */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            style={{ overflow: 'hidden' }}
            className="border-t border-black/[0.04]"
          >
            <AnimatePresence>
              {section.items.map((item, i) => (
                <MenuRow
                  key={item.id + i}
                  item={item}
                  palette={palette}
                  index={i}
                  onNavigate={onNavigate}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
interface MoreTabProps {
  onNavigate: (screenId: string) => void;
}

export default function MoreTab({ onNavigate }: MoreTabProps) {
  const { userData, user } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const settingsPalette = SECTION_PALETTE['settings'];

  return (
    <PageTransition>
      <div
        style={{
          height: 'calc(100dvh - 76px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          paddingBottom: 'calc(32px + env(safe-area-inset-bottom))',
          background: '#fcf9f4',
        }}
        className="flex flex-col px-5 pt-14 no-scrollbar"
      >
        {/* ── Page title ── */}
        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className="font-serif text-[34px] font-light text-[#1A1A1A] mb-6"
        >
          More
        </motion.h1>

        <div className="space-y-4">

          {/* ── Settings Accordion (pinned at top) ── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 24, delay: 0 }}
            className="bg-white border border-black/[0.07] rounded-2xl overflow-hidden shadow-sm"
          >
            {/* Settings header */}
            <motion.button
              onClick={() => setSettingsOpen((v) => !v)}
              whileTap={{ scale: 0.99 }}
              className="flex items-center w-full h-[58px] px-4 gap-3"
            >
              {/* Avatar */}
              <div className="w-9 h-9 rounded-full overflow-hidden border-2 flex-shrink-0" style={{ borderColor: `${GOLD}40` }}>
                {(userData?.photoURL || user?.photoURL) ? (
                  <img
                    src={userData?.photoURL || user?.photoURL}
                    alt="Me"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div
                    className="w-full h-full flex items-center justify-center font-serif text-sm"
                    style={{ background: `${GOLD}20`, color: GOLD }}
                  >
                    {(userData?.displayName || user?.displayName || 'U')[0].toUpperCase()}
                  </div>
                )}
              </div>

              <div className="flex-1 text-left">
                <div className="font-medium text-[14px] text-[#1A1A1A] leading-snug">
                  {userData?.displayName || user?.displayName || 'Your Account'}
                </div>
                <div className="text-[11.5px] text-[#6B6560]">Profile, preferences & more</div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Settings size={16} color={GOLD} />
                <motion.div
                  animate={{ rotate: settingsOpen ? 0 : -90 }}
                  transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                >
                  <ChevronDown size={15} color={`${GOLD}80`} />
                </motion.div>
              </div>
            </motion.button>

            {/* Settings items */}
            <AnimatePresence initial={false}>
              {settingsOpen && (
                <motion.div
                  key="settings-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 280, damping: 28 }}
                  style={{ overflow: 'hidden' }}
                  className="border-t border-black/[0.04]"
                >
                  {SETTINGS_ITEMS.map((item, i) => (
                    <motion.div key={i} custom={i} variants={rowVariants} initial="hidden" animate="show" exit="exit">
                      <motion.button
                        onClick={() => onNavigate(item.id)}
                        whileTap={{ scale: 0.98, backgroundColor: '#f5f1eb' }}
                        className="flex items-center h-[58px] w-full text-left px-4 bg-white border-b border-black/[0.04] last:border-b-0"
                      >
                        <div
                          className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mr-3"
                          style={{ background: settingsPalette.bg }}
                        >
                          <item.icon size={16} color={settingsPalette.fg} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-[13px] text-[#1A1A1A] leading-snug">{item.name}</div>
                          <div className="text-[11px] text-[#6B6560] leading-snug">{item.subtitle}</div>
                        </div>
                        <ChevronDown size={13} color={`${GOLD}60`} className="-rotate-90 flex-shrink-0" />
                      </motion.button>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* ── Other sections ── */}
          {MENU_SECTIONS.map((section, idx) => (
            <motion.div
              key={section.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 24, delay: (idx + 1) * 0.07 }}
            >
              <AccordionSection section={section} onNavigate={onNavigate} />
            </motion.div>
          ))}
        </div>

        {/* Footer */}
        <p className="text-center font-serif italic text-[11px] mt-10 pb-2" style={{ color: `${GOLD}50` }}>
          made with love · by pargat
        </p>
      </div>
    </PageTransition>
  );
}
