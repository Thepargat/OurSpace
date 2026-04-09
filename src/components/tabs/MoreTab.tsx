import { ShoppingCart, Utensils, Brush, StickyNote, PiggyBank, Settings, ChevronRight, Heart } from 'lucide-react';
import { motion } from 'motion/react';
import PageTransition from '../ui/PageTransition';

const MENU_ITEMS = [
  { id: 'grocery', name: 'Grocery List', subtitle: 'Your shared shopping list', icon: ShoppingCart },
  { id: 'meal-planner', name: 'Meal Planner', subtitle: 'Plan your week together', icon: Utensils },
  { id: 'chores', name: 'Chores', subtitle: 'Keep the home running', icon: Brush },
  { id: 'notes', name: 'Shared Notes', subtitle: 'One note, two people', icon: StickyNote },
  { id: 'savings', name: 'Savings Goals', subtitle: 'Working toward something', icon: PiggyBank },
  { id: 'mood-history', name: 'Mood History', subtitle: 'Track your vibes over time', icon: Heart },
  { id: 'settings', name: 'Settings', subtitle: 'Your profile and preferences', icon: Settings },
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

        <div className="flex flex-col">
          {MENU_ITEMS.map((item, index) => {
            const Icon = item.icon;
            return (
              <motion.button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                whileTap={{ scale: 0.98, backgroundColor: "#EDE8DF" }}
                className={`flex items-center h-[64px] w-full text-left px-2 transition-colors ${
                  index !== MENU_ITEMS.length - 1 ? 'border-b border-[#D4CEC4]' : ''
                }`}
              >
                <div className="w-10 flex-shrink-0">
                  <Icon size={22} className="text-[#B8955A]" />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="font-serif text-[18px] text-[#1A1A1A] leading-tight">{item.name}</div>
                  <div className="font-outfit text-[13px] text-[#6B6560] leading-tight">{item.subtitle}</div>
                </div>
                
                <div className="w-6 flex-shrink-0 flex justify-end">
                  <ChevronRight size={20} className="text-[#D4CEC4]" />
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>
    </PageTransition>
  );
}
