import { useState, useRef, useEffect } from "react";
import { motion, useAnimation } from "motion/react";
import { useDrag } from "@use-gesture/react";
import { springs } from "../../lib/motion";
import LottieSpinner from "./LottieSpinner";

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
}

export default function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const controls = useAnimation();
  const containerRef = useRef<HTMLDivElement>(null);
  const maxPull = 120;
  const threshold = 80;

  const bind = useDrag(({ down, movement: [, my], cancel }) => {
    // Only allow pull to refresh if we are at the top of the container
    if (containerRef.current && containerRef.current.scrollTop > 0) {
      return;
    }

    if (isRefreshing) return;

    if (down) {
      // Rubber band effect
      const pullDistance = my > 0 ? Math.min(my * 0.4, maxPull) : 0;
      controls.set({ y: pullDistance });
    } else {
      if (my > threshold) {
        setIsRefreshing(true);
        controls.start({ y: 50, transition: springs.snappy });
        onRefresh().then(() => {
          setIsRefreshing(false);
          controls.start({ y: 0, transition: springs.bouncy });
        });
      } else {
        controls.start({ y: 0, transition: springs.bouncy });
      }
    }
  }, { axis: 'y' });

  // @ts-ignore
  const bindProps = bind();

  return (
    <div ref={containerRef} className="h-full w-full overflow-y-auto overflow-x-hidden touch-pan-y" {...bindProps}>
      <div className="absolute left-0 right-0 top-0 flex justify-center pt-4">
        {isRefreshing && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
          >
            <LottieSpinner />
          </motion.div>
        )}
      </div>
      <motion.div animate={controls} className="min-h-full w-full">
        {children}
      </motion.div>
    </div>
  );
}
