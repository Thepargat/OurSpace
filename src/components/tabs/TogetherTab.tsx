import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import PageTransition from '../ui/PageTransition';
import MemoryWall from './MemoryWall';
import BucketList from './BucketList';

export default function TogetherTab({ onBack }: { onBack?: () => void }) {
  const [activeSubTab, setActiveSubTab] = useState<'memory' | 'bucket'>('memory');

  return (
    <PageTransition>
      <div 
        style={{
          height: 'calc(100dvh - 76px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
          background: '#fcf9f4'
        }}
        className="flex flex-col pt-14 no-scrollbar"
      >
        <div className="px-5 mb-5">
          {onBack && (
            <button onClick={onBack} className="p-2 -ml-2 text-[#1A1A1A] mb-2">
              <ChevronLeft size={24} />
            </button>
          )}
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
            className="font-serif text-[34px] font-light text-[#1A1A1A] mb-6"
          >
            Together
          </motion.h1>
          
          {/* Tab Switcher */}
          <div className="flex gap-8 relative border-b border-[#D4CEC4]/50 pb-2">
            <button 
              className={`font-outfit text-base transition-colors ${activeSubTab === 'memory' ? 'text-[#1A1A1A] font-medium' : 'text-[#6B6560]'}`}
              onClick={() => setActiveSubTab('memory')}
            >
              Memory Wall
            </button>
            <button 
              className={`font-outfit text-base transition-colors ${activeSubTab === 'bucket' ? 'text-[#1A1A1A] font-medium' : 'text-[#6B6560]'}`}
              onClick={() => setActiveSubTab('bucket')}
            >
              Bucket List
            </button>
            
            {/* Sliding Indicator */}
            <motion.div 
              className="absolute bottom-0 h-0.5"
              style={{ background: '#B8955A' }}
              initial={false}
              animate={{ 
                left: activeSubTab === 'memory' ? '0%' : '130px',
                width: activeSubTab === 'memory' ? '105px' : '85px'
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          </div>
        </div>

        <div className="px-6">
          <AnimatePresence mode="wait">
            {activeSubTab === 'memory' ? (
              <motion.div 
                key="memory"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              >
                <MemoryWall />
              </motion.div>
            ) : (
              <motion.div 
                key="bucket"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              >
                <BucketList />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PageTransition>
  );
}
