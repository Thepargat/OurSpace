import { motion } from "motion/react";
import { cn } from "../lib/utils";

interface BottomNavProps {
  activeTab: string;
  onChange: (tab: string) => void;
}

const GOLD = "#B8955A";

const tabs = [
  { id: "home",     label: "Home",     icon: "home" },
  { id: "calendar", label: "Calendar", icon: "event" },
  { id: "mood",     label: "Mood",     icon: "mood" },
  { id: "finances", label: "Finance",  icon: "account_balance" },
  { id: "more",     label: "More",     icon: "more_horiz" },
];

export default function BottomNav({ activeTab, onChange }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[200] flex h-[76px] items-end justify-around px-2 pb-4 bg-[#fcf9f4]/95 backdrop-blur-2xl border-t border-[#D4CEC4]/40 shadow-[0_-8px_32px_rgba(28,28,25,0.06)]">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <motion.button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            whileTap={{ scale: 0.88 }}
            className="relative flex flex-col items-center justify-center gap-0.5 h-full flex-1 select-none"
            aria-label={tab.label}
          >
            {/* Active background pill */}
            {isActive && (
              <motion.div
                layoutId="nav-active-bg"
                className="absolute inset-x-1 top-1 bottom-1 rounded-2xl"
                style={{ background: `${GOLD}18` }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}

            {/* Icon */}
            <motion.span
              className="material-symbols-outlined relative z-10"
              animate={{
                color: isActive ? GOLD : "rgba(28,28,25,0.35)",
                scale: isActive ? 1.08 : 1,
              }}
              transition={{ type: "spring", stiffness: 400, damping: 28 }}
              style={{
                fontSize: 26,
                fontVariationSettings: `'FILL' ${isActive ? 1 : 0}, 'wght' 400`,
                lineHeight: 1,
              }}
            >
              {tab.icon}
            </motion.span>

            {/* Label */}
            <motion.span
              animate={{ color: isActive ? GOLD : "rgba(28,28,25,0.35)" }}
              transition={{ duration: 0.2 }}
              className="relative z-10 text-[10px] font-medium tracking-wide leading-none"
            >
              {tab.label}
            </motion.span>
          </motion.button>
        );
      })}
    </nav>
  );
}
