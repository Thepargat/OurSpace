import { useRef, useState } from "react";
import { motion, useAnimation } from "motion/react";
import { springs } from "../../lib/motion";
import { cn } from "../../lib/utils";

interface AnimatedCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function AnimatedCard({ children, className, onClick, ...props }: AnimatedCardProps) {
  const [isLongPress, setIsLongPress] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const controls = useAnimation();

  const handlePointerDown = () => {
    timeoutRef.current = setTimeout(() => {
      setIsLongPress(true);
      controls.start({
        y: -10,
        boxShadow: "0 20px 40px rgba(184, 149, 90, 0.15), 0 0 0 1px rgba(184, 149, 90, 0.3)",
        transition: springs.soft
      });
    }, 400);
  };

  const handlePointerUp = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (isLongPress) {
      setIsLongPress(false);
      controls.start({
        y: 0,
        boxShadow: "0 2px 8px rgba(26,26,26,0.05), 0 16px 40px rgba(26,26,26,0.04)",
        transition: springs.soft
      });
    }
  };

  return (
    <motion.div
      className={cn("card cursor-pointer", className)}
      whileTap={{ scale: 0.96, transition: springs.bouncy }}
      whileHover={{ 
        y: -5, 
        boxShadow: "0 24px 60px rgba(26,26,26,0.10)",
        transition: springs.soft
      }}
      animate={controls}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onClick={onClick}
      {...props as any}
    >
      {children}
    </motion.div>
  );
}
