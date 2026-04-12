import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { useDrag } from "@use-gesture/react";
import { springs } from "../../lib/motion";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  footer?: React.ReactNode;
  fullScreen?: boolean;
}

export default function BottomSheet({ isOpen, onClose, children, title, footer, fullScreen }: BottomSheetProps) {
  const [y, setY] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (isOpen) {
      setY(0);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen, mounted]);

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

  const bindProps = bind() as Record<string, unknown>;

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence mode="wait">
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[20000]"
            style={{ 
              background: "rgba(26, 26, 26, 0.45)",
              pointerEvents: "auto"
            }}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y }}
            exit={{ y: "100%" }}
            transition={y === 0 ? springs.soft : { type: "tween", duration: 0.1 }}
            className="fixed bottom-0 left-0 right-0 z-[20001] flex flex-col rounded-t-[24px] bg-[#F8F4EE]"
            style={{ 
              y, 
              maxHeight: fullScreen ? "100dvh" : "92dvh",
              height: fullScreen ? "100dvh" : "auto",
              display: isOpen ? 'flex' : 'none' 
            }}
          >
            {/* Drag handle */}
            {!fullScreen && (
              <div 
                {...bindProps} 
                className="flex w-full cursor-grab items-center justify-center pt-3 pb-1 touch-none active:cursor-grabbing flex-shrink-0"
              >
                <div className="h-1 w-10 rounded-full bg-[#D4CEC4]" />
              </div>
            )}

            {/* Scrollable content area */}
            <div className="flex-1 overflow-y-auto px-6 pt-4 pb-2 no-scrollbar -webkit-overflow-scrolling-touch">
              {title && (
                <h2 className="font-serif text-[24px] text-charcoal mb-6 leading-tight">
                  {title}
                </h2>
              )}
              {children}
            </div>

            {/* Sticky save/confirm button pinned at bottom above safe area */}
            {footer && (
              <div className="p-6 pb-[calc(16px+env(safe-area-inset-bottom))] border-t border-[#D4CEC4] bg-[#F8F4EE] flex-shrink-0">
                {footer}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
