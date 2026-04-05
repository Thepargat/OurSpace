import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useDrag } from "@use-gesture/react";
import { springs } from "../../lib/motion";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function BottomSheet({ isOpen, onClose, children }: BottomSheetProps) {
  const [y, setY] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setY(0);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const bind = useDrag(({ down, movement: [, my], velocity: [, vy], direction: [, dy] }) => {
    if (down) {
      // Only allow dragging downwards
      setY(Math.max(0, my));
    } else {
      // Dismiss if dragged down past 40% of screen height or fast flick
      const threshold = window.innerHeight * 0.4;
      if (my > threshold || (vy > 0.5 && dy > 0)) {
        onClose();
      } else {
        // Snap back
        setY(0);
      }
    }
  }, { filterTaps: true });

  // @ts-ignore
  const bindProps = bind();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 bg-charcoal"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y }}
            exit={{ y: "100%" }}
            transition={y === 0 ? springs.soft : { type: "tween", duration: 0.1 }}
            className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[90vh] flex-col rounded-t-[32px] bg-linen shadow-2xl"
            style={{ y }}
          >
            <div 
              {...bindProps} 
              className="flex w-full cursor-grab items-center justify-center pt-4 pb-2 touch-none active:cursor-grabbing"
            >
              <div className="h-1.5 w-12 rounded-full bg-stone" />
            </div>
            <div className="overflow-y-auto px-6 pb-safe pt-4">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
