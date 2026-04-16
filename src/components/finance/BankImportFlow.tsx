/**
 * BankImportFlow — thin upload UI.
 * Picks file → extracts pages → saves to Firestore → closes immediately.
 * All AI processing happens in background via bankImport.ts.
 */
import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, X, Check, AlertTriangle, Zap, Database, Loader2 } from 'lucide-react';
import { useAuth } from '../AuthWrapper';
import { startBankImport } from '../../lib/bankImport';
import { SPRING_DEFAULT, SPRING_BOUNCY } from '../../lib/motion';

interface Props { onClose: () => void; onStarted: () => void; }

export default function BankImportFlow({ onClose, onStarted }: Props) {
  const { householdId, user } = useAuth();
  const [stage, setStage] = useState<'upload' | 'starting' | 'started'>('upload');
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!householdId || !user) return;
    if (!file.name.match(/\.(pdf|csv)$/i)) {
      setError('Please upload a PDF or CSV bank statement.');
      return;
    }
    setError('');
    setStage('starting');
    try {
      await startBankImport(file, householdId, user.uid, (stage, pct) => {
        setStatusMsg(stage);
        setProgress(pct);
      });
      setStage('started');
      setTimeout(() => { onStarted(); onClose(); }, 1800);
    } catch (e: any) {
      setError(e.message || 'Failed to start import');
      setStage('upload');
    }
  }, [householdId, user, onStarted, onClose]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] bg-[#1A1A1A]/60 backdrop-blur-sm flex items-end"
      onClick={stage === 'upload' ? onClose : undefined}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={SPRING_DEFAULT}
        className="bg-[#fcf9f4] rounded-t-[28px] w-full max-h-[80dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-[#D4CEC4] rounded-full mx-auto mt-3 flex-shrink-0" />

        {/* Header */}
        <div className="px-6 pt-4 pb-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-serif text-[22px] text-[#1A1A1A]">Import Bank Statement</h2>
            <p className="font-outfit text-[12px] text-[#6B6560] mt-0.5">
              CommBank · NAB · ANZ · Westpac · Macquarie · ING
            </p>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-10">
          <AnimatePresence mode="wait">

            {/* UPLOAD */}
            {stage === 'upload' && (
              <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <input ref={fileRef} type="file" className="hidden" accept=".csv,.pdf"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

                <motion.div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                  animate={{ scale: isDragging ? 1.02 : 1 }}
                  whileTap={{ scale: 0.97 }}
                  className={`mt-2 rounded-3xl border-2 border-dashed p-10 flex flex-col items-center cursor-pointer transition-colors ${
                    isDragging ? 'border-[#B8955A] bg-[#B8955A]/8' : 'border-[#D4CEC4] hover:border-[#B8955A]/60'
                  }`}
                >
                  <div className="w-16 h-16 rounded-2xl bg-[#EDE8DF] flex items-center justify-center mb-4">
                    <Upload size={28} className="text-[#B8955A]" />
                  </div>
                  <h3 className="font-serif text-[19px] text-[#1A1A1A] mb-1">
                    {isDragging ? 'Drop it here' : 'Choose or drop a file'}
                  </h3>
                  <p className="font-outfit text-[13px] text-[#6B6560] text-center">
                    PDF or CSV · 1 month, 3 months, any size<br />
                    <span className="text-[#B8955A]">You can close this screen straight away</span>
                  </p>
                </motion.div>

                {error && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    className="mt-4 p-4 bg-[#FDF0EE] border border-[#E8A090] rounded-2xl flex items-start gap-3">
                    <AlertTriangle size={15} className="text-[#C47B6A] mt-0.5 flex-shrink-0" />
                    <p className="font-outfit text-[13px] text-[#C47B6A]">{error}</p>
                  </motion.div>
                )}

                {/* Feature grid */}
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {[
                    { icon: <Zap size={13} />, title: 'Background AI', body: 'Close app — processing continues' },
                    { icon: <Database size={13} />, title: 'Merchant cache', body: 'Seen merchants: instant, zero AI cost' },
                    { icon: <Check size={13} />, title: 'Resumable', body: 'Failed pages can be retried later' },
                    { icon: <Check size={13} />, title: 'Duplicate guard', body: 'Already-scanned receipts flagged' },
                  ].map(c => (
                    <div key={c.title} className="bg-[#EDE8DF] rounded-2xl p-3.5">
                      <div className="flex items-center gap-1.5 text-[#B8955A] mb-1">
                        {c.icon}
                        <span className="font-outfit text-[11px] font-semibold">{c.title}</span>
                      </div>
                      <p className="font-outfit text-[11px] text-[#6B6560] leading-snug">{c.body}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* STARTING */}
            {stage === 'starting' && (
              <motion.div key="starting" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="flex flex-col items-center pt-8 pb-4">
                <div className="w-16 h-16 rounded-2xl bg-[#EDE8DF] flex items-center justify-center mb-5">
                  <Loader2 size={28} className="text-[#B8955A] animate-spin" />
                </div>
                <h3 className="font-serif text-[20px] text-[#1A1A1A] mb-1">Preparing import…</h3>
                <p className="font-outfit text-[13px] text-[#6B6560] mb-6 text-center">{statusMsg}</p>
                <div className="w-full h-2 bg-[#EDE8DF] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-[#B8955A] rounded-full"
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                  />
                </div>
                <p className="font-outfit text-[11px] text-[#B8955A] mt-2">{progress}%</p>
                <p className="font-outfit text-[11px] text-[#A8A29E] mt-4 text-center">
                  You can close this — the import will continue in the background
                </p>
              </motion.div>
            )}

            {/* STARTED */}
            {stage === 'started' && (
              <motion.div key="started" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
                transition={SPRING_BOUNCY}
                className="flex flex-col items-center pt-8 pb-4 text-center">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ ...SPRING_BOUNCY, delay: 0.1 }}
                  className="w-20 h-20 rounded-full bg-[#E8F5E9] flex items-center justify-center mb-5">
                  <Check size={36} className="text-[#4CAF50]" strokeWidth={2.5} />
                </motion.div>
                <h3 className="font-serif text-[24px] text-[#1A1A1A] mb-2">Import started</h3>
                <p className="font-outfit text-[14px] text-[#6B6560]">
                  Gemini 2.5 is reading your statement in the background.<br />
                  Come back to Finance → you'll see a Review banner when it's ready.
                </p>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
