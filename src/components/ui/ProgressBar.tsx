import { motion, AnimatePresence } from "motion/react";

export default function ProgressBar({ isLoading }: { isLoading: boolean }) {
  return (
    <AnimatePresence>
      {isLoading && (
        <motion.div
          initial={{ scaleX: 0, opacity: 1 }}
          animate={{ scaleX: 1, opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ 
            scaleX: { duration: 1.5, ease: "circOut" },
            opacity: { duration: 0.3 }
          }}
          className="fixed left-0 right-0 top-0 z-50 h-[2px] origin-left bg-brass"
        />
      )}
    </AnimatePresence>
  );
}
