import { motion } from "motion/react";
import { springs } from "../../lib/motion";

interface SplitTextProps {
  text: string;
  className?: string;
}

export default function SplitText({ text, className }: SplitTextProps) {
  const letters = Array.from(text);
  
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.035 }
    }
  };

  const letterAnim = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: springs.soft }
  };

  return (
    <motion.span 
      variants={container} 
      initial="hidden" 
      animate="show" 
      className={className}
      style={{ display: "inline-block" }}
    >
      {letters.map((char, i) => (
        <motion.span 
          key={i} 
          variants={letterAnim} 
          className="inline-block"
        >
          {char === " " ? "\u00A0" : char}
        </motion.span>
      ))}
    </motion.span>
  );
}
