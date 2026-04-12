import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";

interface FullScreenLottieCelebrationProps {
  lottieUrl: string;
  duration?: number;
  onComplete: () => void;
}

export default function FullScreenLottieCelebration({ lottieUrl, duration = 2800, onComplete }: FullScreenLottieCelebrationProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onComplete();
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onComplete]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
      >
        <div className="absolute inset-0 bg-linen/80 backdrop-blur-sm" />
        <div className="relative z-10 w-full max-w-md flex flex-col items-center gap-4">
          <motion.div 
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="text-6xl"
          >
            ✨
          </motion.div>
          <p className="font-serif text-2xl text-charcoal">Celebrating!</p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
