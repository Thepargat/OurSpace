import { motion } from "motion/react";

export default function LottieSpinner() {
  return (
    <div className="relative flex h-12 w-12 items-center justify-center">
      <motion.div
        animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0.2, 0.6] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        className="absolute h-6 w-6 rounded-full bg-brass mix-blend-multiply"
      />
      <motion.div
        animate={{ scale: [1.4, 1, 1.4], opacity: [0.2, 0.6, 0.2] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        className="absolute h-6 w-6 rounded-full bg-brass mix-blend-multiply"
      />
    </div>
  );
}
