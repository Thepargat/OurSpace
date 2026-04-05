import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import Lottie from "lottie-react";

interface FullScreenLottieCelebrationProps {
  lottieUrl: string;
  duration?: number;
  onComplete: () => void;
}

export default function FullScreenLottieCelebration({ lottieUrl, duration = 2800, onComplete }: FullScreenLottieCelebrationProps) {
  const [animationData, setAnimationData] = useState<any>(null);

  useEffect(() => {
    fetch(lottieUrl)
      .then(res => res.json())
      .then(data => setAnimationData(data))
      .catch(err => {
        console.error("Failed to load celebration Lottie", err);
        onComplete();
      });
  }, [lottieUrl, onComplete]);

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
        {animationData && (
          <div className="relative z-10 w-full max-w-md">
            <Lottie animationData={animationData} loop={false} />
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
