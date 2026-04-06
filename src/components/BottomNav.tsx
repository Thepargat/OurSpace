import { Home, Calendar, CreditCard, Heart, MoreHorizontal } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "../lib/utils";

interface BottomNavProps {
  activeTab: string;
  onChange: (tab: string) => void;
}

export default function BottomNav({ activeTab, onChange }: BottomNavProps) {
  const tabs = [
    { id: "home", label: "Home", icon: Home },
    { id: "calendar", label: "Calendar", icon: Calendar },
    { id: "finances", label: "Finances", icon: CreditCard },
    { id: "together", label: "Together", icon: Heart },
    { id: "more", label: "More", icon: MoreHorizontal },
  ];

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 z-40 flex h-[80px] items-center justify-around border-t border-[#D4CEC4]/30 pb-[env(safe-area-inset-bottom)]"
      style={{
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        background: "rgba(248, 244, 238, 0.85)",
      }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className="relative flex h-[52px] w-[52px] flex-col items-center justify-center gap-1 transition-colors"
            aria-label={tab.label}
          >
            {isActive && (
              <motion.div
                layoutId="bottomNavIndicator"
                className="absolute top-0 h-[5px] w-[5px] rounded-full bg-[#B8955A]"
                transition={{ type: "spring", stiffness: 300, damping: 24 }}
              />
            )}
            <Icon 
              size={24} 
              strokeWidth={isActive ? 2.5 : 1.5}
              className={cn(
                "transition-all duration-300",
                isActive ? "text-[#B8955A]" : "text-[#D4CEC4]"
              )} 
            />
            <span 
              className={cn(
                "text-[10px] font-outfit transition-all duration-300",
                isActive ? "text-[#B8955A] font-medium" : "text-[#D4CEC4]"
              )}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
