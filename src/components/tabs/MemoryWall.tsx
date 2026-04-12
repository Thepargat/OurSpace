import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, ChevronLeft, ChevronRight, Loader2, Camera, Image as ImageIcon, Trash2 } from 'lucide-react';
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
import MemoryWall3D from '../3d/MemoryWall3D';

const normalizeDate = (date: any): Date => {
  if (!date) return new Date();
  if (typeof date === 'string') return new Date(date);
  if (date && typeof date.toDate === 'function') return date.toDate();
  return new Date(date);
};

const ensureDate = (val: any): Date | null => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val.toDate === 'function') return val.toDate();
  if (typeof val === 'object' && val.seconds !== undefined) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

interface Memory {
  id: string;
  imageURL: string;
  caption?: string;
  date: Timestamp;
  uploadedBy: string;
  uploaderName?: string;
  uploaderPhoto?: string;
  storagePath?: string;
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
  const [viewMode, setViewMode] = useState<'grid' | 'immersive'>('grid');
  const [isSelectionSheetOpen, setIsSelectionSheetOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setIsSelectionSheetOpen(false);
    setIsCaptionSheetOpen(true);
  };

  const saveMemory = async () => {
    if (!selectedFile || !householdId || !user) return;
    if (isSaving) return;

    setIsSaving(true);
    setUploadProgress(0);

    try {
      const timestamp = Date.now();
      const ext = selectedFile.name.split('.').pop() || 'jpg';
      const filename = `${timestamp}.${ext}`;
      const storagePath = `households/${householdId}/memories/${filename}`;
      const storageRef = ref(storage, storagePath);

      // Upload with progress tracking
      await new Promise<void>((resolve, reject) => {
        const uploadTask = uploadBytesResumable(storageRef, selectedFile);
        uploadTask.on(
          'state_changed',
          (snap) => {
            setUploadProgress((snap.bytesTransferred / snap.totalBytes) * 100);
          },
          (err) => reject(err),
          () => resolve()
        );
      });

      const downloadURL = await getDownloadURL(storageRef);

      await addDoc(collection(db, 'households', householdId, 'memories'), {
        imageURL: downloadURL,
        caption: caption.trim(),
        date: serverTimestamp(),
        uploadedBy: user.uid,
        uploaderName: userData?.displayName || user.displayName || 'Partner',
        uploaderPhoto: userData?.photoURL || user.photoURL || '',
        storagePath,
      });

      notifyPartner(
        householdId,
        user.uid,
        'Memory Wall',
        `${userData?.displayName || user.displayName || 'Partner'} added a new memory ❤️`,
        'memories'
      );

      // Reset state
      setUploadProgress(null);
      setIsSaving(false);
      setIsCaptionSheetOpen(false);
      setCaption('');
      setSelectedFile(null);
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error: any) {
      console.error('Memory save error:', error);
      setUploadProgress(null);
      setIsSaving(false);
      const msg = error?.code === 'storage/unauthorized'
        ? 'Storage permission denied. Please check Firebase Storage rules (see below).'
        : error?.message || 'Upload failed. Check your connection.';
      alert(msg);
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

      <div className="flex justify-between items-center mb-6">
        <h2 className="font-serif text-2xl text-[#1A1A1A]">
          {viewMode === 'grid' ? 'Moments' : 'Immersive'}
        </h2>
        <div className="flex bg-[#EDE8DF] p-1 rounded-full border border-[#D4CEC4]">
          <button 
            onClick={() => setViewMode('grid')}
            className={`px-4 py-1.5 rounded-full font-outfit text-xs font-medium transition-all ${
              viewMode === 'grid' ? 'bg-[#1A1A1A] text-white shadow-sm' : 'text-[#6B6560]'
            }`}
          >
            Grid
          </button>
          <button 
            onClick={() => setViewMode('immersive')}
            className={`px-4 py-1.5 rounded-full font-outfit text-xs font-medium transition-all ${
              viewMode === 'immersive' ? 'bg-[#1A1A1A] text-white shadow-sm' : 'text-[#6B6560]'
            }`}
          >
            3D
          </button>
        </div>
      </div>

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
        <AnimatePresence mode="wait">
          {viewMode === 'grid' ? (
            <motion.div 
              key="grid"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="columns-2 gap-4 space-y-4 pb-32"
            >
              {memories.map((memory, index) => (
                <motion.div
                  key={memory.id}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 25 }}
                  className="relative break-inside-avoid group"
                  onClick={() => setSelectedMemoryIndex(index)}
                >
                  <div className="rounded-2xl overflow-hidden bg-[#EDE8DF]">
                    <BlurImage 
                      src={memory.imageURL} 
                      alt={memory.caption || "Memory"} 
                      className="w-full h-auto"
                    />
                  </div>

                  {/* Delete Button (Grid) */}
                  {user?.uid === memory.uploadedBy && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMemory(memory);
                      }}
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}

                  <div className="mt-2 px-1">
                    <p className="font-outfit text-[12px] text-[#6B6560] flex items-center gap-1.5">
                      <span className="font-medium text-[#1A1A1A]">{memory.uploaderName}</span>
                      <span className="opacity-40">•</span>
                      <span>{memory.date ? format(ensureDate(memory.date)!, 'MMM d, yyyy') : 'Just now'}</span>
                    </p>
                    {memory.caption && (
                      <p className="font-outfit text-sm text-[#1A1A1A] mt-1 line-clamp-2">{memory.caption}</p>
                    )}
                  </div>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="immersive"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pb-32"
            >
              <MemoryWall3D images={memories.map(m => m.imageURL)} />
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Selection Sheet */}
      <BottomSheet 
        isOpen={isSelectionSheetOpen} 
        onClose={() => setIsSelectionSheetOpen(false)}
      >
        <div className="py-4 space-y-2 pb-8">
          <h3 className="font-serif text-xl text-[#1A1A1A] mb-4">Choose Photo</h3>
          <button 
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.setAttribute('capture', 'environment');
                fileInputRef.current.click();
              }
            }}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[#EDE8DF] border border-[#D4CEC4] active:scale-[0.98] transition-all"
          >
            <div className="w-10 h-10 rounded-full bg-[#1A1A1A] flex items-center justify-center text-white">
              <Camera size={20} />
            </div>
            <div className="text-left">
              <p className="font-outfit font-medium text-[#1A1A1A]">Take Photo</p>
              <p className="font-outfit text-xs text-[#6B6560]">Use your camera</p>
            </div>
          </button>
          <button 
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.removeAttribute('capture');
                fileInputRef.current.click();
              }
            }}
            className="w-full flex items-center gap-4 p-4 rounded-2xl bg-[#EDE8DF] border border-[#D4CEC4] active:scale-[0.98] transition-all"
          >
            <div className="w-10 h-10 rounded-full bg-[#B8955A] flex items-center justify-center text-white">
              <ImageIcon size={20} />
            </div>
            <div className="text-left">
              <p className="font-outfit font-medium text-[#1A1A1A]">Photo Library</p>
              <p className="font-outfit text-xs text-[#6B6560]">Choose from your phone</p>
            </div>
          </button>
        </div>
      </BottomSheet>

      {/* FAB */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        onClick={() => setIsSelectionSheetOpen(true)}
        className="fixed bottom-[100px] right-6 w-14 h-14 bg-[#1A1A1A] text-white rounded-full flex items-center justify-center shadow-lg z-50"
      >
        <Plus size={28} />
      </motion.button>

      <input 
        type="file" 
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleFileSelect}
      />

      {/* Caption Sheet */}
      <BottomSheet 
        isOpen={isCaptionSheetOpen} 
        onClose={() => {
          setIsCaptionSheetOpen(false);
          setSelectedFile(null);
          setPreviewUrl(null);
        }}
        footer={
          <button
            onClick={saveMemory}
            disabled={isSaving}
            className="w-full h-14 bg-[#1A1A1A] text-white rounded-full font-outfit font-medium text-lg shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? <Loader2 className="animate-spin" size={20} /> : 'Save Memory ✦'}
          </button>
        }
      >
        <div className="py-2">
          {previewUrl && (
            <div className="w-full aspect-square rounded-2xl overflow-hidden mb-6 bg-[#EDE8DF] border border-[#D4CEC4]">
              <img src={previewUrl} className="w-full h-full object-cover" alt="Preview" />
            </div>
          )}
          <textarea
            autoFocus
            placeholder="Add a caption..."
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="w-full bg-transparent border-none focus:ring-0 font-serif text-[20px] text-[#1A1A1A] placeholder-[#6B6560]/40 resize-none min-h-[80px]"
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
            onDelete={async (memory) => {
              await deleteMemory(memory);
              setSelectedMemoryIndex(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Lightbox({ memories, initialIndex, onClose, onDelete }: { memories: Memory[], initialIndex: number, onClose: () => void, onDelete: (m: Memory) => void }) {
  const { user } = useAuth();
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

      {/* Delete (Lightbox) */}
      {user?.uid === memories[index].uploadedBy && (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onDelete(memories[index]);
          }}
          className="absolute top-6 right-20 w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center text-red-500 hover:bg-red-500/40 transition-all z-20"
        >
          <Trash2 size={20} />
        </button>
      )}

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
