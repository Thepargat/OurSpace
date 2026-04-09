import { ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';
import PageTransition from '../ui/PageTransition';

interface SubScreenProps {
  title: string;
  onBack: () => void;
}

export default function SubScreen({ title, onBack }: SubScreenProps) {
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
        className="flex flex-col px-6 pt-16 no-scrollbar"
      >
        <div className="flex items-center gap-4 mb-8">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onBack}
            className="p-2 -ml-2 text-[#1A1A1A]"
          >
            <ArrowLeft size={22} />
          </motion.button>
          <h1 className="font-serif text-3xl text-[#1A1A1A]">{title}</h1>
        </div>
        
        <div className="flex-1 flex items-center justify-center text-center px-12">
          <div>
            <div className="w-24 h-24 bg-[#EDE8DF] rounded-full flex items-center justify-center mb-6 mx-auto border border-[#D4CEC4]">
              <span className="text-4xl opacity-50">✨</span>
            </div>
            <h2 className="font-serif text-2xl text-[#1A1A1A] mb-2">{title}</h2>
            <p className="font-outfit text-[#6B6560]">This feature is coming soon to your shared space.</p>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
