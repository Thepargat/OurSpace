import { motion } from "motion/react";
import { cn } from "../lib/utils";

interface BottomNavProps {
  activeTab: string;
  onChange: (tab: string) => void;
}

export default function BottomNav({ activeTab, onChange }: BottomNavProps) {
  const tabs = [
    { id: "home", label: "Home", icon: "home" },
    { id: "calendar", label: "Tasks", icon: "calendar_today" },
    { id: "together", label: "Stories", icon: "favorite" },
    { id: "finances", label: "Goals", icon: "payments" },
    { id: "more", label: "More", icon: "menu" },
  ];

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 z-[100] flex h-[90px] items-center justify-around px-4 pb-[env(safe-area-inset-bottom)] bg-[#fcf9f4]/90 backdrop-blur-2xl rounded-t-[3rem] shadow-[0_-10px_40px_rgba(28,28,25,0.04)]"
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className="relative flex flex-col items-center justify-center transition-all duration-300"
            aria-label={tab.label}
          >
            <motion.div
              animate={{
                scale: isActive ? 1.1 : 1,
                backgroundColor: isActive ? "#bc0100" : "transparent",
                color: isActive ? "#ffffff" : "rgba(28, 28, 25, 0.4)",
              }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className={cn(
                "flex items-center justify-center w-12 h-12 rounded-full",
                isActive && "shadow-[0_0_20px_rgba(188,1,0,0.3)]"
              )}
            >
              <span 
                className={cn(
                  "material-symbols-outlined text-[24px]",
                  isActive ? "fill-1" : "fill-0"
                )}
                style={{ fontVariationSettings: `'FILL' ${isActive ? 1 : 0}, 'wght' 400` }}
              >
                {tab.icon}
              </span>
            </motion.div>
            
            {/* Optional Small Label if needed, user didn't explicitly ask to remove it but design shows clean pills */}
            <span className={cn("text-[10px] font-jakarta mt-1 tracking-tight transition-colors duration-300", isActive ? "text-primary font-bold" : "text-on-surface/40")}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
