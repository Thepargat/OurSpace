import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import PageTransition from '../ui/PageTransition';
import MemoryWall from './MemoryWall';
import BucketList from './BucketList';

export default function TogetherTab() {
  const [activeSubTab, setActiveSubTab] = useState<'memory' | 'bucket'>('memory');

  return (
    <PageTransition>
      <div 
        style={{
          height: 'calc(100dvh - 80px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          paddingBottom: 'calc(32px + env(safe-area-inset-bottom))',
          background: '#F8F4EE'
        }}
        className="flex flex-col pt-16 no-scrollbar"
      >
        <div className="px-6 mb-6">
          <h1 className="font-serif text-4xl font-light text-[#1A1A1A] mb-8">Together</h1>
          
          {/* Tab Switcher */}
          <div className="flex gap-8 relative border-b border-[#D4CEC4]/50 pb-2">
            <button 
              className={`font-outfit text-lg transition-colors ${activeSubTab === 'memory' ? 'text-[#1A1A1A]' : 'text-[#6B6560]'}`}
              onClick={() => setActiveSubTab('memory')}
            >
              Memory Wall
            </button>
            <button 
              className={`font-outfit text-lg transition-colors ${activeSubTab === 'bucket' ? 'text-[#1A1A1A]' : 'text-[#6B6560]'}`}
              onClick={() => setActiveSubTab('bucket')}
            >
              Bucket List
            </button>
            
            {/* Sliding Indicator */}
            <motion.div 
              className="absolute bottom-0 h-0.5 bg-[#B8955A]"
              initial={false}
              animate={{ 
                left: activeSubTab === 'memory' ? '0%' : '135px',
                width: activeSubTab === 'memory' ? '110px' : '90px'
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
