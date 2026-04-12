import { motion } from 'framer-motion';
import { CreditCard, Wrench, ActivitySquare, ShoppingCart, Utensils, Brush, StickyNote, PiggyBank, Settings, ChevronRight, Heart } from 'lucide-react';
import PageTransition from '../ui/PageTransition';

const GOLD = "#B8955A";

const MENU_SECTIONS = [
  {
    heading: 'Daily Life',
    emoji: '🏠',
    items: [
      { id: 'grocery',      name: 'Grocery List',   subtitle: 'Your shared shopping list',  icon: ShoppingCart },
      { id: 'meal-planner', name: 'Meal Planner',   subtitle: 'Plan your week together',     icon: Utensils },
      { id: 'chores',       name: 'Chores',         subtitle: 'Keep the home running',       icon: Brush },
      { id: 'notes',        name: 'Shared Notes',   subtitle: 'One note, two people',        icon: StickyNote },
    ],
  },
  {
    heading: 'Money & Home',
    emoji: '💰',
    items: [
      { id: 'subscriptions', name: 'Subscriptions', subtitle: 'Track recurring charges',      icon: CreditCard },
      { id: 'home-car',      name: 'Home & Car',    subtitle: 'Maintenance tracker',          icon: Wrench },
      { id: 'savings',       name: 'Savings Goals', subtitle: 'Working toward something',     icon: PiggyBank },
    ],
  },
  {
    heading: 'You & Your Partner',
    emoji: '❤️',
    items: [
      { id: 'activity',     name: 'Activity Feed',  subtitle: 'See everything happening',     icon: ActivitySquare },
      { id: 'mood-history', name: 'Mood History',   subtitle: 'Track your vibes over time',   icon: Heart },
      { id: 'settings',     name: 'Settings',       subtitle: 'Your profile and preferences', icon: Settings },
    ],
  },
];

const sectionVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const rowVariants = {
  hidden: { opacity: 0, x: -16 },
  show: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
  },
};

interface MoreTabProps {
  onNavigate: (screenId: string) => void;
}

export default function MoreTab({ onNavigate }: MoreTabProps) {
  return (
    <PageTransition>
      <div
        style={{
          height: 'calc(100dvh - 76px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
          background: '#fcf9f4',
        }}
        className="flex flex-col px-5 pt-14 no-scrollbar"
      >
        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className="font-serif text-[34px] font-light text-[#1A1A1A] mb-6"
        >
          More
        </motion.h1>

        <motion.div
          variants={sectionVariants}
          initial="hidden"
          animate="show"
          className="space-y-6"
        >
          {MENU_SECTIONS.map((section) => (
            <motion.div key={section.heading} variants={rowVariants}>
              {/* Section heading */}
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-base leading-none">{section.emoji}</span>
                <p className="font-medium text-[11px] uppercase tracking-[2px]" style={{ color: GOLD }}>
                  {section.heading}
                </p>
              </div>

              {/* Section card */}
              <div className="bg-white border border-black/[0.06] rounded-2xl overflow-hidden shadow-sm">
                {section.items.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <motion.button
                      key={item.id}
                      onClick={() => onNavigate(item.id)}
                      whileTap={{ scale: 0.98, backgroundColor: '#f5f1eb' }}
                      className={`flex items-center h-[62px] w-full text-left px-4 bg-white transition-colors ${
                        index !== section.items.length - 1 ? 'border-b border-black/[0.05]' : ''
                      }`}
                    >
                      {/* Icon bubble */}
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mr-3"
                        style={{ background: `${GOLD}18` }}
                      >
                        <Icon size={18} color={GOLD} />
                      </div>

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-[14px] text-[#1A1A1A] leading-tight">{item.name}</div>
                        <div className="text-[12px] text-[#6B6560] leading-tight mt-0.5">{item.subtitle}</div>
                      </div>

                      {/* Chevron */}
                      <ChevronRight size={16} color={`${GOLD}80`} className="flex-shrink-0 ml-2" />
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Footer credit */}
        <p className="text-center font-serif italic text-[11px] mt-8 pb-2" style={{ color: `${GOLD}60` }}>
          made with love · by pargat
        </p>
      </div>
    </PageTransition>
  );
}
