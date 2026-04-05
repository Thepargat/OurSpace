import { motion } from "motion/react";
import { cn } from "../../lib/utils";

interface SkeletonLoaderProps {
  className?: string;
}

export default function SkeletonLoader({ className }: SkeletonLoaderProps) {
  return (
    <div className={cn("relative overflow-hidden bg-parchment rounded-2xl", className)}>
      <motion.div
        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent"
        animate={{
          translateX: ["-100%", "100%"]
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: "linear"
        }}
      />
    </div>
  );
}
