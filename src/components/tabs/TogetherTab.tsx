import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Tilt from 'react-parallax-tilt';
import PageTransition from '../ui/PageTransition';
import MemoryWall3D from '../3d/MemoryWall3D';
import BlurImage from '../ui/BlurImage';

const BUCKET_LIST = [
  { id: 1, title: "See the Northern Lights", location: "Iceland", image: "https://images.unsplash.com/photo-1520769945061-0a448c463865?q=80&w=1000&auto=format&fit=crop", done: false },
  { id: 2, title: "Hot Air Balloon Ride", location: "Cappadocia", image: "https://images.unsplash.com/photo-1527568541991-888636b13197?q=80&w=1000&auto=format&fit=crop", done: true },
  { id: 3, title: "Pasta Making Class", location: "Rome", image: "https://images.unsplash.com/photo-1556761223-4c4282c73f77?q=80&w=1000&auto=format&fit=crop", done: false },
];

function BucketList() {
  const [items, setItems] = useState(BUCKET_LIST);

  const toggleDone = (id: number) => {
    setItems(prev => prev.map(item => 
      item.id === id ? { ...item, done: !item.done } : item
    ));
  };

  return (
    <div className="space-y-6 pb-32">
      {items.map(item => (
        <Tilt key={item.id} tiltMaxAngleX={10} tiltMaxAngleY={10} scale={1.02} transitionSpeed={2000}>
          <motion.div 
            className="relative h-48 rounded-3xl cursor-pointer shadow-md"
            onClick={() => toggleDone(item.id)}
            style={{ transformStyle: "preserve-3d" }}
            animate={{ rotateY: item.done ? 180 : 0 }}
            transition={{ duration: 0.6, type: "spring", stiffness: 260, damping: 20 }}
          >
            {/* Front Side */}
            <div 
              className="absolute inset-0 rounded-3xl overflow-hidden"
              style={{ backfaceVisibility: "hidden" }}
            >
              <BlurImage 
                src={item.image} 
                alt={item.title} 
                className="absolute inset-0"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#1A1A1A]/80 to-transparent" />
              <div className="absolute bottom-0 left-0 p-6">
                <h3 className="font-serif text-2xl text-white mb-1">{item.title}</h3>
                <p className="font-outfit text-white/80 text-sm tracking-wider uppercase">{item.location}</p>
              </div>
            </div>

            {/* Back Side */}
            <div 
              className="absolute inset-0 bg-[#B8955A] rounded-3xl flex flex-col items-center justify-center"
              style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            >
              <motion.div
                initial={false}
                animate={{ scale: item.done ? 1 : 0 }}
                transition={{ delay: 0.3, type: "spring" }}
                className="w-16 h-16 rounded-full border-2 border-white flex items-center justify-center mb-4"
              >
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </motion.div>
              <h3 className="font-serif text-2xl text-white">Done</h3>
            </div>
          </motion.div>
        </Tilt>
      ))}
    </div>
  );
}

export default function TogetherTab() {
  const [activeSubTab, setActiveSubTab] = useState<'memory' | 'bucket'>('memory');

  return (
    <PageTransition>
      <div className="flex h-full flex-col pt-16 bg-[#F8F4EE]">
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

        <div className="flex-1 relative">
          <AnimatePresence mode="wait">
            {activeSubTab === 'memory' ? (
              <motion.div 
                key="memory"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="absolute inset-0"
              >
                <MemoryWall3D />
              </motion.div>
            ) : (
              <motion.div 
                key="bucket"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="absolute inset-0 px-6 overflow-y-auto"
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
