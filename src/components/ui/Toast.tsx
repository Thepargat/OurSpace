import { motion, AnimatePresence } from 'motion/react';
import { Wifi, WifiOff } from 'lucide-react';

interface ToastProps {
  message: string;
  type: 'online' | 'offline';
  isVisible: boolean;
}

export default function Toast({ message, type, isVisible }: ToastProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm"
        >
          <div className={`
            flex items-center gap-3 px-6 py-4 rounded-2xl shadow-xl border
            ${type === 'offline' 
              ? 'bg-parchment border-stone text-charcoal' 
              : 'bg-charcoal border-charcoal text-linen'}
          `}>
            {type === 'offline' ? (
              <WifiOff size={20} className="text-warm-grey" />
            ) : (
              <Wifi size={20} className="text-brass" />
            )}
            <span className="font-outfit font-medium">{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
