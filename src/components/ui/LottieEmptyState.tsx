import { motion } from "motion/react";
import { Leaf, Sun, Image as ImageIcon, Coins, Globe2 } from "lucide-react";

interface LottieEmptyStateProps {
  message: string;
  fallbackIcon: "plant" | "sun" | "polaroid" | "coins" | "globe";
}

export default function LottieEmptyState({ message, fallbackIcon }: LottieEmptyStateProps) {
  const renderFallback = () => {
    switch (fallbackIcon) {
      case "plant":
        return (
          <motion.div animate={{ scale: [0.9, 1.05, 0.9] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
            <Leaf className="h-16 w-16 text-brass/40" strokeWidth={1.5} />
          </motion.div>
        );
      case "sun":
        return (
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: "linear" }}>
            <Sun className="h-16 w-16 text-brass/40" strokeWidth={1.5} />
          </motion.div>
        );
      case "polaroid":
        return (
          <motion.div animate={{ y: [-5, 5, -5], rotate: [-2, 2, -2] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
            <ImageIcon className="h-16 w-16 text-brass/40" strokeWidth={1.5} />
          </motion.div>
        );
      case "coins":
        return (
          <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
            <Coins className="h-16 w-16 text-brass/40" strokeWidth={1.5} />
          </motion.div>
        );
      case "globe":
        return (
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 15, repeat: Infinity, ease: "linear" }}>
            <Globe2 className="h-16 w-16 text-brass/40" strokeWidth={1.5} />
          </motion.div>
        );
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="flex flex-col items-center justify-center p-8 text-center"
    >
      <div className="flex h-[120px] w-[120px] items-center justify-center opacity-90">
        {renderFallback()}
      </div>
      <p className="mt-4 font-sans text-[15px] text-warm-grey">{message}</p>
    </motion.div>
  );
}
