import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Bell, Moon, Shield, LogOut } from 'lucide-react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import PageTransition from '../ui/PageTransition';

function ProfileCard({ name, role, isOnline, image }: { name: string, role: string, isOnline: boolean, image: string }) {
  return (
    <div className="bg-parchment rounded-3xl p-4 border border-stone shadow-sm flex items-center gap-4">
      <div className="relative">
        <img src={image} alt={name} className="w-16 h-16 rounded-full object-cover" />
        <div className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-parchment ${isOnline ? 'bg-green-500' : 'bg-stone'}`} />
      </div>
      <div>
        <h3 className="font-serif text-xl text-charcoal">{name}</h3>
        <p className="font-outfit text-sm text-warm-grey">{role}</p>
      </div>
    </div>
  );
}

function AnniversaryCountdown() {
  const [days, setDays] = useState(14); // Example

  return (
    <div className="relative bg-charcoal rounded-3xl p-10 overflow-hidden text-center shadow-lg">
      {/* Elegant floating particles */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        {[...Array(15)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1.5 h-1.5 bg-brass rounded-full blur-[1px]"
            initial={{ 
              x: Math.random() * 400, 
              y: 250,
              opacity: 0 
            }}
            animate={{ 
              y: -50,
              opacity: [0, 1, 1, 0],
              x: (Math.random() - 0.5) * 100 + (Math.random() * 400)
            }}
            transition={{ 
              duration: 4 + Math.random() * 4, 
              repeat: Infinity,
              delay: Math.random() * 5,
              ease: "linear" 
            }}
          />
        ))}
      </div>
      
      <h3 className="font-outfit text-brass text-sm tracking-[0.2em] uppercase mb-4 relative z-10">Anniversary In</h3>
      <div className="font-serif text-8xl text-linen font-light relative z-10 flex items-baseline justify-center gap-2">
        {days} <span className="text-2xl text-warm-grey font-outfit uppercase tracking-widest">days</span>
      </div>
    </div>
  );
}

export default function MoreTab() {
  const [notes, setNotes] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const notesDoc = doc(db, 'shared', 'notes');
    const unsubscribe = onSnapshot(notesDoc, (doc) => {
      if (doc.exists()) {
        setNotes(doc.data().content);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleNotesChange = async (newContent: string) => {
    setNotes(newContent);
    setIsSyncing(true);
    try {
      await setDoc(doc(db, 'shared', 'notes'), { content: newContent });
    } catch (error) {
      console.error("Error syncing notes:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <PageTransition>
      <div className="flex h-full flex-col px-6 pt-16 pb-32 overflow-y-auto bg-texture-3">
        <h1 className="font-serif text-4xl font-light text-charcoal mb-8">More</h1>

        {/* Profiles */}
        <div className="grid grid-cols-1 gap-4 mb-8">
          <ProfileCard 
            name="Alex" 
            role="Partner" 
            isOnline={true} 
            image="https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?q=80&w=200&auto=format&fit=crop" 
          />
          <ProfileCard 
            name="Jordan" 
            role="You" 
            isOnline={true} 
            image="https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=200&auto=format&fit=crop" 
          />
        </div>

        {/* Countdown */}
        <div className="mb-8">
          <AnniversaryCountdown />
        </div>

        {/* Shared Notes */}
        <div className="mb-8">
          <h2 className="font-serif text-2xl text-charcoal mb-4">Shared Notes</h2>
          <div className="bg-parchment rounded-3xl p-6 border border-stone shadow-sm relative">
            <div className={`absolute top-4 right-4 w-2 h-2 rounded-full ${isSyncing ? 'bg-brass animate-pulse' : 'bg-green-500'}`} title={isSyncing ? "Syncing..." : "Live Syncing"} />
            <textarea
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
              className="w-full h-32 bg-transparent resize-none font-outfit text-charcoal focus:outline-none"
              placeholder="Type something shared..."
            />
          </div>
        </div>

        {/* Settings */}
        <div>
          <h2 className="font-serif text-2xl text-charcoal mb-4">Settings</h2>
          <div className="bg-white rounded-3xl border border-stone overflow-hidden shadow-sm">
            <button className="w-full flex items-center gap-4 p-4 border-b border-stone hover:bg-parchment transition-colors text-left">
              <Bell className="text-warm-grey" size={20} />
              <span className="font-outfit text-charcoal flex-1">Notifications</span>
              <div className="w-10 h-6 bg-brass rounded-full relative">
                <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full" />
              </div>
            </button>
            <button className="w-full flex items-center gap-4 p-4 border-b border-stone hover:bg-parchment transition-colors text-left">
              <Moon className="text-warm-grey" size={20} />
              <span className="font-outfit text-charcoal flex-1">Dark Mode</span>
              <div className="w-10 h-6 bg-stone rounded-full relative">
                <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full" />
              </div>
            </button>
            <button className="w-full flex items-center gap-4 p-4 border-b border-stone hover:bg-parchment transition-colors text-left">
              <Shield className="text-warm-grey" size={20} />
              <span className="font-outfit text-charcoal flex-1">Privacy</span>
            </button>
            <button className="w-full flex items-center gap-4 p-4 hover:bg-red-50 transition-colors text-left text-red-500">
              <LogOut size={20} />
              <span className="font-outfit flex-1">Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
