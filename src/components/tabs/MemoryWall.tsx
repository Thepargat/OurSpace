import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytesResumable, 
  getDownloadURL,
  deleteObject
} from 'firebase/storage';
import { db, storage } from '../../firebase';
import { useAuth } from '../AuthWrapper';
import BlurImage from '../ui/BlurImage';
import BottomSheet from '../ui/BottomSheet';
import { format } from 'date-fns';
import { notifyPartner } from '../../services/notificationService';

const normalizeDate = (date: any): Date => {
  if (!date) return new Date();
  if (typeof date === 'string') return new Date(date);
  if (date && typeof date.toDate === 'function') return date.toDate();
  return new Date(date);
};

interface Memory {
  id: string;
  imageURL: string;
  caption?: string;
  date: Timestamp;
  uploadedBy: string;
  uploaderName?: string;
  uploaderPhoto?: string;
}

export default function MemoryWall() {
  const { user, householdId, userData } = useAuth();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isCaptionSheetOpen, setIsCaptionSheetOpen] = useState(false);
  const [currentUploadId, setCurrentUploadId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [selectedMemoryIndex, setSelectedMemoryIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Real-time listener
  useEffect(() => {
    if (!householdId) return;

    const q = query(
      collection(db, 'households', householdId, 'memories'),
      orderBy('date', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newMemories = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Memory[];
      setMemories(newMemories);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [householdId]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !householdId || !user) return;

    const timestamp = Date.now();
    const filename = `${timestamp}_${file.name}`;
    const storageRef = ref(storage, `households/${householdId}/memories/${filename}`);
    
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on('state_changed', 
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setUploadProgress(progress);
      }, 
      (error) => {
        console.error("Upload error:", error);
        setUploadProgress(null);
      }, 
      async () => {
        const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
        
        // Create initial doc
        const docRef = await addDoc(collection(db, 'households', householdId, 'memories'), {
          imageURL: downloadURL,
          date: serverTimestamp(),
          uploadedBy: user.uid,
          uploaderName: userData?.displayName || user.displayName || 'Partner',
          uploaderPhoto: userData?.photoURL || user.photoURL || '',
          storagePath: `households/${householdId}/memories/${filename}` // Store for deletion
        });

        // Trigger Notification
        notifyPartner(
          householdId,
          user.uid,
          "Memory Wall",
          `${userData?.displayName || user.displayName || 'Partner'} added a new memory ❤️`,
          "memories"
        );

        setCurrentUploadId(docRef.id);
        setUploadProgress(null);
        setIsCaptionSheetOpen(true);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    );
  };

  const saveCaption = async () => {
    if (!currentUploadId || !householdId) return;

    try {
      const memoryRef = doc(db, 'households', householdId, 'memories', currentUploadId);
      await updateDoc(memoryRef, { caption });
      
      setIsCaptionSheetOpen(false);
      setCaption('');
      setCurrentUploadId(null);
    } catch (error) {
      console.error("Error saving caption:", error);
    }
  };

  const deleteMemory = async (memory: Memory) => {
    if (!householdId || user?.uid !== memory.uploadedBy) return;

    if (window.confirm('Delete this memory?')) {
      try {
        await deleteDoc(doc(db, 'households', householdId, 'memories', memory.id));
        // Also delete from storage if we have the path
        // For simplicity I'll just delete the firestore doc for now unless I stored the path
        // I added storagePath in handleFileSelect
        const memoryData = memory as any;
        if (memoryData.storagePath) {
          const storageRef = ref(storage, memoryData.storagePath);
          await deleteObject(storageRef);
        }
      } catch (error) {
        console.error("Error deleting memory:", error);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-[#B8955A] animate-spin mb-4" />
        <p className="font-outfit text-[#6B6560]">Loading memories...</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-full">
      {/* Upload Progress Bar */}
      <AnimatePresence>
        {uploadProgress !== null && (
          <motion.div 
            initial={{ scaleX: 0 }}
            animate={{ scaleX: uploadProgress / 100 }}
            exit={{ opacity: 0 }}
            className="fixed top-0 left-0 right-0 h-1 bg-[#B8955A] origin-left z-[1000]"
          />
        )}
      </AnimatePresence>

      {memories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-center px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <h2 className="font-serif text-[24px] text-[#1A1A1A]">No memories yet</h2>
            <p className="font-outfit text-[14px] text-[#6B6560]">Add your first moment together</p>
          </motion.div>
        </div>
      ) : (
        <div className="columns-2 gap-4 space-y-4 pb-32">
          {memories.map((memory, index) => (
            <motion.div
              key={memory.id}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="relative break-inside-avoid group"
              onClick={() => setSelectedMemoryIndex(index)}
              onContextMenu={(e) => {
                e.preventDefault();
                deleteMemory(memory);
              }}
            >
              <div className="rounded-2xl overflow-hidden bg-[#EDE8DF]">
                <BlurImage 
                  src={memory.imageURL} 
                  alt={memory.caption || "Memory"} 
                  className="w-full h-auto"
                />
              </div>
              <div className="mt-2 px-1">
                <p className="font-outfit text-[12px] text-[#6B6560] flex items-center gap-1.5">
                  <span className="font-medium text-[#1A1A1A]">{memory.uploaderName}</span>
                  <span className="opacity-40">•</span>
                  <span>{memory.date ? format(normalizeDate(memory.date), 'MMM d, yyyy') : 'Just now'}</span>
                </p>
                {memory.caption && (
                  <p className="font-outfit text-sm text-[#1A1A1A] mt-1 line-clamp-2">{memory.caption}</p>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* FAB */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => fileInputRef.current?.click()}
        className="fixed bottom-[100px] right-6 w-14 h-14 bg-[#1A1A1A] text-white rounded-full flex items-center justify-center shadow-lg z-50"
      >
        <Plus size={28} />
      </motion.button>

      <input 
        type="file" 
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
      />

      {/* Caption Sheet */}
      <BottomSheet 
        isOpen={isCaptionSheetOpen} 
        onClose={() => setIsCaptionSheetOpen(false)}
        footer={
          <button
            onClick={saveCaption}
            className="w-full h-14 bg-[#1A1A1A] text-white rounded-full font-outfit font-medium text-lg shadow-lg"
          >
            Save Memory ✦
          </button>
        }
      >
        <div className="py-4">
          <textarea
            autoFocus
            placeholder="Add a caption..."
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="w-full bg-transparent border-none focus:ring-0 font-serif text-[20px] text-[#1A1A1A] placeholder-[#6B6560]/40 resize-none min-h-[120px]"
          />
        </div>
      </BottomSheet>

      {/* Lightbox */}
      <AnimatePresence>
        {selectedMemoryIndex !== null && (
          <Lightbox 
            memories={memories} 
            initialIndex={selectedMemoryIndex} 
            onClose={() => setSelectedMemoryIndex(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Lightbox({ memories, initialIndex, onClose }: { memories: Memory[], initialIndex: number, onClose: () => void }) {
  const [index, setIndex] = useState(initialIndex);

  const next = () => setIndex((prev) => (prev + 1) % memories.length);
  const prev = () => setIndex((prev) => (prev - 1 + memories.length) % memories.length);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[10000] bg-[#1A1A1A] flex flex-col"
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          {memories[index].uploaderPhoto && (
            <img src={memories[index].uploaderPhoto} className="w-8 h-8 rounded-full border border-white/20" />
          )}
          <div>
            <p className="text-white font-outfit text-sm font-medium">{memories[index].uploaderName}</p>
            <p className="text-white/60 font-outfit text-xs">
              {memories[index].date ? format(normalizeDate(memories[index].date), 'MMMM d, yyyy') : 'Just now'}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white">
          <X size={20} />
        </button>
      </div>

      {/* Image Container */}
      <div className="flex-1 relative flex items-center justify-center p-4">
        <motion.div
          key={index}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.1 }}
          className="relative max-w-full max-h-full"
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          onDragEnd={(_, info) => {
            if (info.offset.x > 100) prev();
            else if (info.offset.x < -100) next();
          }}
        >
          <img 
            src={memories[index].imageURL} 
            className="max-w-full max-h-[70dvh] object-contain rounded-xl shadow-2xl" 
            alt={memories[index].caption || "Memory"}
          />
          {memories[index].caption && (
            <div className="mt-8 text-center px-6">
              <p className="font-serif text-xl text-white/90 italic leading-relaxed">
                "{memories[index].caption}"
              </p>
            </div>
          )}
        </motion.div>

        {/* Navigation Arrows (Desktop) */}
        <button 
          onClick={(e) => { e.stopPropagation(); prev(); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all hidden md:flex"
        >
          <ChevronLeft size={24} />
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); next(); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/5 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all hidden md:flex"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {/* Footer / Counter */}
      <div className="p-8 text-center">
        <p className="text-white/40 font-outfit text-xs tracking-widest uppercase">
          {index + 1} / {memories.length}
        </p>
      </div>
    </motion.div>
  );
}
