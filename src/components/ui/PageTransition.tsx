import { motion } from "motion/react";
import { pageVariants } from "../../lib/motion";

export default function PageTransition({ children, className = "" }: { children: React.ReactNode, className?: string }) {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className={`h-full w-full ${className}`}
    >
      {children}
    </motion.div>
  );
}
