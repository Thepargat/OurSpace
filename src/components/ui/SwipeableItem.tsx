import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useDrag } from "@use-gesture/react";
import { springs } from "../../lib/motion";
import { Check, Trash2 } from "lucide-react";
import { triggerBrassBurst } from "../../lib/confetti";

interface SwipeableItemProps {
  children: React.ReactNode;
  onComplete?: () => void;
  onDelete?: () => void;
  removeOnComplete?: boolean;
  removeOnDelete?: boolean;
}

export default function SwipeableItem({ 
  children, 
  onComplete, 
  onDelete, 
  removeOnComplete = true, 
  removeOnDelete = true 
}: SwipeableItemProps) {
  const [x, setX] = useState(0);
  const [isRemoved, setIsRemoved] = useState(false);
  const threshold = 80;

  const bind = useDrag(({ down, movement: [mx], velocity: [vx], direction: [dx], event }) => {
    if (isRemoved) return;

    if (down) {
      setX(mx);
    } else {
      if (mx > threshold || (vx > 0.5 && dx > 0)) {
        // Complete
        if (removeOnComplete) {
          setX(window.innerWidth);
          setIsRemoved(true);
        } else {
          setX(0);
        }
        if (event && 'clientX' in event && 'clientY' in event) {
          triggerBrassBurst((event as MouseEvent).clientX, (event as MouseEvent).clientY);
        } else {
          triggerBrassBurst(window.innerWidth / 2, window.innerHeight / 2);
        }
        setTimeout(() => { if (onComplete) onComplete(); }, removeOnComplete ? 300 : 0);
      } else if (mx < -threshold || (vx > 0.5 && dx < 0)) {
        // Delete
        if (removeOnDelete) {
          setX(-window.innerWidth);
          setIsRemoved(true);
        } else {
          setX(0);
        }
        setTimeout(() => { if (onDelete) onDelete(); }, removeOnDelete ? 300 : 0);
      } else {
        // Reset
        setX(0);
      }
    }
  });

  // @ts-ignore
  const bindProps = bind();

  return (
    <AnimatePresence>
      {!isRemoved && (
        <motion.div 
          layout
          initial={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0, marginBottom: 0, transition: springs.soft }}
          className="relative w-full overflow-hidden rounded-2xl mb-3"
        >
          {/* Background actions */}
          <div className="absolute inset-0 flex items-center justify-between overflow-hidden">
            {/* Green wash (Complete) */}
            <motion.div 
              className="absolute inset-y-0 left-0 bg-green-100 flex items-center pl-6"
              style={{ 
                width: x > 0 ? x + 100 : 0,
                opacity: x > 0 ? Math.min(x / threshold, 1) : 0
              }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-200 text-green-600">
                <Check size={20} />
              </div>
            </motion.div>

            {/* Red wash (Delete) */}
            <motion.div 
              className="absolute inset-y-0 right-0 bg-red-100 flex items-center justify-end pr-6"
              style={{ 
                width: x < 0 ? Math.abs(x) + 100 : 0,
                opacity: x < 0 ? Math.min(Math.abs(x) / threshold, 1) : 0
              }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-200 text-red-600">
                <Trash2 size={20} />
              </div>
            </motion.div>
          </div>

          {/* Foreground item */}
          <motion.div
            {...bindProps}
            animate={{ x }}
            transition={x === 0 ? springs.bouncy : { type: "tween", duration: 0.2 }}
            className="relative z-10 touch-pan-y"
            style={{ x }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
