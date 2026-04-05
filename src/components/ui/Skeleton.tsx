import { motion } from "motion/react";
import { cn } from "../../lib/utils";

export default function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-parchment", className)}>
      <motion.div
        animate={{ x: ["-100%", "200%"] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
        className="absolute inset-0 z-10 bg-gradient-to-r from-transparent via-stone/20 to-transparent"
      />
    </div>
  );
}
