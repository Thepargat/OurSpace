import { CreditCard, Wrench, ActivitySquare, ShoppingCart, Utensils, Brush, StickyNote, PiggyBank, Settings, ChevronRight, Heart } from 'lucide-react';
import { motion } from 'framer-motion';
import PageTransition from '../ui/PageTransition';

const MENU_SECTIONS = [
  {
    heading: 'Daily Life',
    items: [
      { id: 'grocery', name: 'Grocery List', subtitle: 'Your shared shopping list', icon: ShoppingCart },
      { id: 'meal-planner', name: 'Meal Planner', subtitle: 'Plan your week together', icon: Utensils },
      { id: 'chores', name: 'Chores', subtitle: 'Keep the home running', icon: Brush },
      { id: 'notes', name: 'Shared Notes', subtitle: 'One note, two people', icon: StickyNote },
    ],
  },
  {
    heading: 'Money & Home',
    items: [
      { id: 'subscriptions', name: 'Subscriptions', subtitle: 'Track recurring charges', icon: CreditCard },
      { id: 'home-car', name: 'Home & Car', subtitle: 'Maintenance tracker', icon: Wrench },
      { id: 'savings', name: 'Savings Goals', subtitle: 'Working toward something', icon: PiggyBank },
    ],
  },
  {
    heading: 'You & Your Partner',
    items: [
      { id: 'activity', name: 'Activity Feed', subtitle: 'See everything happening', icon: ActivitySquare },
      { id: 'mood-history', name: 'Mood History', subtitle: 'Track your vibes over time', icon: Heart },
      { id: 'settings', name: 'Settings', subtitle: 'Your profile and preferences', icon: Settings },
    ],
  },
];

interface MoreTabProps {
  onNavigate: (screenId: string) => void;
}

export default function MoreTab({ onNavigate }: MoreTabProps) {
  return (
    <PageTransition>
      <div
        style={{
          height: 'calc(100dvh - 80px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          paddingBottom: 'calc(32px + env(safe-area-inset-bottom))',
          background: '#F8F4EE'
        }}
        className="flex flex-col px-6 pt-16 no-scrollbar"
      >
        <h1 className="font-serif text-[36px] font-light text-[#1A1A1A] mb-8">More</h1>

        <div className="space-y-8">
          {MENU_SECTIONS.map(section => (
            <div key={section.heading}>
              <p className="font-outfit text-[10px] uppercase tracking-[2.5px] text-[#B8955A] mb-3">
                {section.heading}
              </p>
              <div className="bg-[#EDE8DF] border border-[#D4CEC4] rounded-[22px] overflow-hidden">
                {section.items.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <motion.button
                      key={item.id}
                      onClick={() => onNavigate(item.id)}
                      whileTap={{ scale: 0.98, backgroundColor: 'rgba(212,206,196,0.5)' }}
                      className={`flex items-center h-[64px] w-full text-left px-4 transition-colors ${
                        index !== section.items.length - 1 ? 'border-b border-[#D4CEC4]' : ''
                      }`}
                    >
                      <div className="w-10 flex-shrink-0">
                        <Icon size={20} className="text-[#B8955A]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-outfit text-[15px] font-medium text-[#1A1A1A] leading-tight">{item.name}</div>
                        <div className="font-outfit text-[12px] text-[#6B6560] leading-tight">{item.subtitle}</div>
                      </div>
                      <div className="w-6 flex-shrink-0 flex justify-end">
                        <ChevronRight size={18} className="text-[#B8955A] opacity-50" />
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageTransition>
  );
}
