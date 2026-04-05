import { useState, useRef } from "react";
import { motion } from "motion/react";
import { triggerBrassBurst } from "../../lib/confetti";
import { cn } from "../../lib/utils";

interface GroceryItemProps {
  id: string;
  text: string;
  initialChecked?: boolean;
  onToggle?: (id: string, checked: boolean) => void;
}

export default function GroceryItem({ id, text, initialChecked = false, onToggle }: GroceryItemProps) {
  const [isChecked, setIsChecked] = useState(initialChecked);
  const checkboxRef = useRef<HTMLButtonElement>(null);

  const handleToggle = () => {
    const newChecked = !isChecked;
    setIsChecked(newChecked);
    
    if (newChecked && checkboxRef.current) {
      const rect = checkboxRef.current.getBoundingClientRect();
      triggerBrassBurst(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }

    if (onToggle) {
      onToggle(id, newChecked);
    }
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ 
        opacity: isChecked ? 0.6 : 1, 
        y: 0,
        scale: isChecked ? 0.98 : 1
      }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className="flex items-center gap-4 p-3 rounded-xl bg-parchment border border-stone shadow-sm"
    >
      <button
        ref={checkboxRef}
        onClick={handleToggle}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors duration-300",
          isChecked ? "border-brass bg-brass text-linen" : "border-stone bg-transparent"
        )}
      >
        <motion.svg
          initial={false}
          animate={{ scale: isChecked ? 1 : 0, opacity: isChecked ? 1 : 0 }}
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </motion.svg>
      </button>
      
      <span className="relative text-charcoal font-medium text-lg">
        {text}
        <motion.span
          className="absolute left-0 top-1/2 h-[2px] bg-charcoal/40"
          initial={false}
          animate={{ width: isChecked ? "100%" : "0%" }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          style={{ translateY: "-50%" }}
        />
      </span>
    </motion.div>
  );
}
