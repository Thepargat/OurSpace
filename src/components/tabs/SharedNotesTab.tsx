import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  limit,
  Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../AuthWrapper';
import { formatDistanceToNow } from 'date-fns';

interface SharedNote {
  content: string;
  lastEditedBy?: string;
  lastEditorName?: string;
  lastEditedAt?: Timestamp;
}

interface PartnerInfo {
  uid: string;
  displayName: string;
  isTypingNotes?: boolean;
}

export default function SharedNotesTab({ onBack }: { onBack: () => void }) {
  const { user, householdId, userData } = useAuth();
  const [note, setNote] = useState<SharedNote | null>(null);
  const [localContent, setLocalContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');
  const [partner, setPartner] = useState<PartnerInfo | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isLocalChangeRef = useRef(false);

  // 1. Listen to Shared Note
  useEffect(() => {
    if (!householdId) return;

    const noteRef = doc(db, 'households', householdId, 'notes', 'shared');
    const unsubscribe = onSnapshot(noteRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as SharedNote;
        setNote(data);
        
        // Only update local content if the change came from someone else
        if (!isLocalChangeRef.current) {
          setLocalContent(data.content);
        }
        isLocalChangeRef.current = false;
      } else {
        // Initialize if doesn't exist
        setNote({ content: '' });
        setLocalContent('');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [householdId]);

  // 2. Find and Listen to Partner
  useEffect(() => {
    if (!householdId || !user) return;

    const q = query(
      collection(db, 'users'),
      where('householdId', '==', householdId),
      where('uid', '!=', user.uid),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const partnerDoc = snapshot.docs[0];
        setPartner({
          uid: partnerDoc.id,
          ...partnerDoc.data()
        } as PartnerInfo);
      }
    });

    return () => unsubscribe();
  }, [householdId, user]);

  // 3. Keyboard Height Handling
  useEffect(() => {
    if (!window.visualViewport) return;

    const handleResize = () => {
      const height = window.innerHeight - (window.visualViewport?.height || window.innerHeight);
      setKeyboardHeight(Math.max(0, height));
    };

    window.visualViewport.addEventListener('resize', handleResize);
    return () => window.visualViewport?.removeEventListener('resize', handleResize);
  }, []);

  // 4. Typing Indicator Logic
  const updateTypingStatus = useCallback(async (isTyping: boolean) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        isTypingNotes: isTyping
      });
    } catch (err) {
      console.error("Error updating typing status:", err);
    }
  }, [user]);

  // 5. Save Logic (Debounced)
  const saveToFirestore = useCallback(async (content: string) => {
    if (!householdId || !user) {
      console.error("Missing householdId or user for saving note");
      return;
    }

    setSaveStatus('saving');
    try {
      const noteRef = doc(db, 'households', householdId, 'notes', 'shared');
      await setDoc(noteRef, {
        content,
        lastEditedBy: user.uid,
        lastEditorName: userData?.displayName || user.displayName || 'Partner',
        lastEditedAt: serverTimestamp()
      }, { merge: true });
      setSaveStatus('saved');
    } catch (err) {
      console.error("Error saving note:", err);
      setSaveStatus('saved'); // Reset even on error
    }
  }, [householdId, user, userData]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setLocalContent(newContent);
    isLocalChangeRef.current = true;
    setSaveStatus('saving');

    // Handle Typing Indicator
    updateTypingStatus(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      updateTypingStatus(false);
    }, 2000);

    // Handle Debounced Save
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveToFirestore(newContent);
    }, 800);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#fcf9f4]">
        <Loader2 className="h-8 w-8 animate-spin text-[#B8955A]" />
      </div>
    );
  }

  return (
    <div 
      className="flex flex-col bg-[#fcf9f4] transition-all duration-300 ease-out"
      style={{ 
        height: '100dvh',
        paddingBottom: keyboardHeight > 0 ? `${keyboardHeight}px` : 'env(safe-area-inset-bottom)'
      }}
    >
      {/* Header */}
      <div className="px-6 pt-16 pb-4 relative">
        <button 
          onClick={onBack}
          className="absolute top-16 left-4 p-2 text-[#1A1A1A]"
        >
          <ChevronLeft size={24} />
        </button>
        
        <div className="ml-8">
          <h1 className="font-serif text-[32px] text-[#1A1A1A] leading-none mb-1">Notes</h1>
          {note?.lastEditedAt && typeof note.lastEditedAt.toDate === 'function' && (
            <p className="font-outfit text-[13px] text-[#6B6560]">
              Last edited by {note.lastEditedBy === user?.uid ? 'you' : note.lastEditorName} · {formatDistanceToNow(note.lastEditedAt.toDate(), { addSuffix: true })}
            </p>
          )}
        </div>

        {/* Partner Typing Indicator */}
        <AnimatePresence>
          {partner?.isTypingNotes && (
            <motion.div
              initial={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -10, filter: 'blur(4px)' }}
              className="absolute top-6 left-1/2 -translate-x-1/2 bg-[#EDE8DF] border border-[#D4CEC4] rounded-full px-3.5 py-1.5 z-50 shadow-sm"
            >
              <p className="font-outfit text-[13px] text-[#B8955A]">
                {partner.displayName} is typing...
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={localContent}
        onChange={handleTextChange}
        placeholder="Write something..."
        className="w-full flex-1 bg-transparent border-none outline-none resize-none font-outfit text-[17px] leading-[1.7] text-[#1A1A1A] p-6 caret-[#B8955A] placeholder-[#D4CEC4]"
      />

      {/* Auto-save Indicator */}
      <div className="px-6 py-3 flex justify-end">
        <p className="font-outfit text-[11px] text-[#D4CEC4] uppercase tracking-widest">
          {saveStatus === 'saving' ? 'Saving...' : 'Saved'}
        </p>
      </div>
    </div>
  );
}
