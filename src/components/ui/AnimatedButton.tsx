import { HTMLMotionProps, motion } from "motion/react";
import { springs } from "../../lib/motion";
import { cn } from "../../lib/utils";

interface AnimatedButtonProps extends HTMLMotionProps<"button"> {
  children: React.ReactNode;
}

export default function AnimatedButton({ children, className, ...props }: AnimatedButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.96, filter: "brightness(0.93)", transition: springs.bouncy }}
      className={cn("flex h-[52px] w-full items-center justify-center rounded-full bg-charcoal text-white font-medium transition-colors", className)}
      {...props}
    >
      {children}
    </motion.button>
  );
}
