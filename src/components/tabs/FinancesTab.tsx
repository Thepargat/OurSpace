/**
 * OurSpace — FinancesTab (Complete Rebuild)
 * 3 tabs: Overview | Explorer | Analytics
 * Canvas charts, drill-down, item search, ML forecasts, bank import
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Search, X, ChevronLeft, ChevronRight, MoreHorizontal,
  TrendingUp, TrendingDown, Minus, Check, Trash2,
  Loader2, ChevronDown
} from 'lucide-react';
import { useAuth } from '../AuthWrapper';
import { db, storage } from '../../firebase';
import {
  collection, query, onSnapshot, addDoc, serverTimestamp,
  orderBy, doc, deleteDoc, Timestamp, getDoc, updateDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { format, startOfMonth, subMonths, addMonths } from 'date-fns';
import { GoogleGenerativeAI } from '@google/generative-ai';

import { getCategoryDef, colors } from '../../design/tokens';
import { categorizeItem } from '../../lib/categorization';
import { useCurrencyCountUp, SPRING_DEFAULT, SPRING_BOUNCY, haptic, fireCelebration } from '../../lib/motion';
import { buildMonthlyAggregates, forecastCategories, calculateBudgetHealth, formatAUD, formatCompact } from '../../lib/cashflow';
import BankImportFlow from '../finance/BankImportFlow';

// ============================================================
// TYPES
// ============================================================
interface LineItem {
  id: string;
  name: string;
  price: number;
  quantity?: number;
  unitPrice?: number;
  category: string;
  assignedTo: 'user' | 'partner' | 'shared';
}

interface Expense {
  id: string;
  merchantName: string;
  total: number;
  date: Date;
  category: string;
  lineItems: LineItem[];
  paidBy: string;
  source?: string;
  imageURL?: string;
  notes?: string;
  budgetMonth: string; // YYYY-MM
  splits?: { userId: string; amount: number }[];
  scannedBy?: string;
  scannedByName?: string;
  scannedByPhoto?: string;
}

interface CategoryBudget {
  id: string;
  category: string;
  limit: number;
}

// ============================================================
// CONSTANTS
// ============================================================
const MONTH_BUDGET_KEY = 'ourspace_monthly_budget';

// ============================================================
// CANVAS DONUT CHART
// ============================================================
function DonutChart({
  data,
  total,
  onSliceClick,
}: {
  data: Array<{ category: string; amount: number; color: string }>;
  total: number;
  onSliceClick: (cat: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const progressRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2 - 8;
    const innerR = outerR * 0.58;

    const start = Date.now();
    const duration = 1000;

    const draw = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      ctx.clearRect(0, 0, size, size);

      let startAngle = -Math.PI / 2;
      for (const seg of data) {
        const pct  = total > 0 ? seg.amount / total : 0;
        const sweep = pct * 2 * Math.PI * eased;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, outerR, startAngle, startAngle + sweep);
        ctx.closePath();
        ctx.fillStyle = seg.color;
        ctx.fill();
        startAngle += sweep;
      }

      // Inner circle (donut hole)
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
      ctx.fillStyle = colors.linen;
      ctx.fill();

      if (progress < 1) {
        animRef.current = requestAnimationFrame(draw);
      }
    };

    cancelAnimationFrame(animRef.current);
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [data, total]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width) - canvas.width / 2;
    const y = (e.clientY - rect.top) * (canvas.height / rect.height) - canvas.height / 2;
    const dist = Math.sqrt(x * x + y * y);
    const outerR = canvas.width / 2 - 8;
    const innerR = outerR * 0.58;
    if (dist < innerR || dist > outerR) return;

    let angle = Math.atan2(y, x) + Math.PI / 2;
    if (angle < 0) angle += 2 * Math.PI;

    let startAngle = 0;
    for (const seg of data) {
      const sweep = total > 0 ? (seg.amount / total) * 2 * Math.PI : 0;
      if (angle >= startAngle && angle < startAngle + sweep) {
        onSliceClick(seg.category);
        return;
      }
      startAngle += sweep;
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={180}
      height={180}
      className="cursor-pointer"
      onClick={handleClick}
      style={{ touchAction: 'none' }}
    />
  );
}

// ============================================================
// CANVAS BAR CHART (weekly)
// ============================================================
function WeeklyBarChart({ weeklyTotals }: { weeklyTotals: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const max = Math.max(...weeklyTotals, 1);
    const barW = W / weeklyTotals.length - 8;
    const currentWeek = Math.floor((new Date().getDate() - 1) / 7);

    const start = Date.now();
    const duration = 700;

    const draw = () => {
      const p = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 2);

      ctx.clearRect(0, 0, W, H);

      weeklyTotals.forEach((val, i) => {
        const x = i * (barW + 8) + 4;
        const barH = (val / max) * (H - 20) * eased;
        const y = H - barH;

        const isCurrent = i === currentWeek;
        ctx.fillStyle = isCurrent ? colors.brass : colors.stone;
        ctx.beginPath();
        const r = 4;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + barW - r, y);
        ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
        ctx.lineTo(x + barW, H);
        ctx.lineTo(x, H);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
      });

      if (p < 1) requestAnimationFrame(draw);
    };
    draw();
  }, [weeklyTotals]);

  return <canvas ref={canvasRef} width={280} height={80} className="w-full" />;
}

// ============================================================
// RECEIPT SCAN (camera → Gemini 2.5 Flash)
// ============================================================
async function scanReceipt(file: File, householdId: string): Promise<{
  merchantName: string;
  total: number;
  lineItems: LineItem[];
  date?: string;
  subtotal?: number;
  tax?: number;
}> {
  const apiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Finance scanning requires VITE_GEMINI_API_KEY');

  const reader = new FileReader();
  const base64 = await new Promise<string>((res, rej) => {
    reader.onload = e => res((e.target?.result as string).split(',')[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await model.generateContent([
    { inlineData: { mimeType: file.type as any, data: base64 } },
    `You are an expert receipt parser. Extract ALL details from this receipt. Return ONLY valid JSON (no markdown, no comments):
{
  "merchantName": "exact store name from receipt",
  "date": "YYYY-MM-DD or null",
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00,
  "lineItems": [
    {
      "name": "exact item name",
      "quantity": 1,
      "unitPrice": 0.00,
      "price": 0.00
    }
  ]
}

Rules:
- Include EVERY line item on the receipt
- quantity: number of units purchased (default 1 if not shown)
- unitPrice: price for ONE unit (price / quantity)
- price: total line item price (quantity × unitPrice)
- subtotal: sum before tax
- tax: tax amount (0 if not shown)
- total: grand total including tax. If not visible, sum all items + tax
- Do NOT include subtotal/tax/total as line items`
  ]);

  const text = result.response.text().trim()
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  const parsed = JSON.parse(text);

  // Categorize each line item
  const items: LineItem[] = await Promise.all(
    (parsed.lineItems || []).map(async (item: any, i: number) => {
      const catResult = await categorizeItem(item.name, parsed.merchantName, householdId);
      const qty = parseFloat(item.quantity) || 1;
      const unitPrice = parseFloat(item.unitPrice) || parseFloat(item.price) / qty || 0;
      const totalPrice = parseFloat(item.price) || unitPrice * qty;
      return {
        id: `item-${i}`,
        name: item.name || 'Item',
        price: Math.round(totalPrice * 100) / 100,
        quantity: qty,
        unitPrice: Math.round(unitPrice * 100) / 100,
        category: catResult.cat,
        assignedTo: 'shared' as const,
      };
    })
  );

  const computedTotal = items.reduce((s, i) => s + i.price, 0);
  const finalTotal = parseFloat(parsed.total) || computedTotal;

  return {
    merchantName: parsed.merchantName || 'Unknown',
    total: Math.round(finalTotal * 100) / 100,
    subtotal: parseFloat(parsed.subtotal) || computedTotal,
    tax: parseFloat(parsed.tax) || 0,
    lineItems: items,
    date: parsed.date || null,
  };
}

// ============================================================
// RECEIPT CARD
// ============================================================
function ReceiptCard({
  expense, isExpanded, onToggle, onDelete, currentUserId, partnerData,
}: {
  expense: Expense; isExpanded: boolean; onToggle: () => void; onDelete: () => void;
  currentUserId: string;
  partnerData?: { uid: string; displayName: string; photoURL: string };
}) {
  const catDef = getCategoryDef(expense.category);

  return (
    <motion.div layout className="bg-white border border-black/[0.06] rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <motion.div className="flex items-center gap-3 p-4 cursor-pointer" onClick={onToggle} whileTap={{ scale: 0.99 }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[18px] flex-shrink-0" style={{ background: catDef.light }}>
          {catDef.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-outfit text-[14px] font-semibold text-[#1A1A1A] truncate">{expense.merchantName}</p>
          <p className="font-outfit text-[11px] text-[#6B6560]">
            {format(expense.date, 'd MMM yyyy')}
            {expense.lineItems.length > 0 && ` · ${expense.lineItems.length} item${expense.lineItems.length > 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {expense.scannedByPhoto && (
            <img src={expense.scannedByPhoto} className="w-5 h-5 rounded-full border border-[#D4CEC4]" referrerPolicy="no-referrer" />
          )}
          <p className="font-serif text-[16px] text-[#1A1A1A]">{formatAUD(expense.total)}</p>
          <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={SPRING_DEFAULT}>
            <ChevronDown size={16} className="text-[#B8955A]" />
          </motion.div>
        </div>
      </motion.div>

      {/* Expanded line items */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING_DEFAULT}
            className="overflow-hidden border-t border-black/[0.05]"
          >
            <div className="p-4 pt-3 space-y-1.5">
              {/* Column headers */}
              <div className="flex items-center gap-2 pb-1 border-b border-black/[0.05] mb-2">
                <span className="w-5 flex-shrink-0" />
                <span className="flex-1 font-outfit text-[10px] uppercase tracking-wider text-[#6B6560]">Item</span>
                <span className="w-20 text-right font-outfit text-[10px] uppercase tracking-wider text-[#6B6560]">Qty × Price</span>
                <span className="w-16 text-right font-outfit text-[10px] uppercase tracking-wider text-[#6B6560]">Total</span>
              </div>

              {expense.lineItems.map(item => {
                const itemCat = getCategoryDef(item.category);
                const unitPrice = (item as any).unitPrice || item.price / (item.quantity || 1);
                return (
                  <div key={item.id} className="flex items-center gap-2 py-1">
                    <span className="text-[13px] flex-shrink-0 w-5">{itemCat.emoji}</span>
                    <span className="flex-1 font-outfit text-[12px] text-[#1A1A1A] truncate">{item.name}</span>
                    {(item.quantity || 1) > 1 ? (
                      <span className="w-20 text-right font-outfit text-[11px] text-[#6B6560]">
                        {item.quantity}×{formatAUD(unitPrice)}
                      </span>
                    ) : (
                      <span className="w-20 text-right font-outfit text-[11px] text-[#6B6560]">—</span>
                    )}
                    <span className="w-16 text-right font-outfit text-[13px] text-[#1A1A1A] font-medium">{formatAUD(item.price)}</span>
                  </div>
                );
              })}

              {/* Totals footer */}
              <div className="pt-2 mt-1 border-t border-black/[0.05]">
                <div className="flex justify-between items-center">
                  <button onClick={onDelete} className="flex items-center gap-1 font-outfit text-[11px] text-[#C47B6A]">
                    <Trash2 size={11} /> Delete
                  </button>
                  <div className="text-right">
                    <p className="font-serif text-[15px] text-[#1A1A1A] font-semibold">{formatAUD(expense.total)}</p>
                    <p className="font-outfit text-[10px] text-[#6B6560]">{expense.lineItems.length} item{expense.lineItems.length > 1 ? 's' : ''}</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ============================================================
// CATEGORY DRILL-DOWN SCREEN
// ============================================================
function CategoryDrillDown({
  category,
  expenses,
  onBack,
}: {
  category: string;
  expenses: Expense[];
  onBack: () => void;
}) {
  const catDef = getCategoryDef(category);
  const catExpenses = expenses.filter(e =>
    e.category === category || e.lineItems.some(i => i.category === category)
  );

  const allItems: Array<{ name: string; price: number; merchant: string; date: Date }> = [];
  for (const exp of catExpenses) {
    const items = exp.lineItems.filter(i => i.category === category);
    if (items.length > 0) {
      items.forEach(item => allItems.push({ name: item.name, price: item.price, merchant: exp.merchantName, date: exp.date }));
    } else {
      allItems.push({ name: exp.merchantName, price: exp.total, merchant: exp.merchantName, date: exp.date });
    }
  }

  const total = allItems.reduce((s, i) => s + i.price, 0);

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={SPRING_DEFAULT}
      className="fixed inset-0 z-[200] bg-[#fcf9f4] flex flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-3 border-b border-[#D4CEC4] flex-shrink-0">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center"
        >
          <ChevronLeft size={20} className="text-[#1A1A1A]" />
        </button>
        <span className="text-[20px]">{catDef.emoji}</span>
        <div>
          <h2 className="font-serif text-[20px] text-[#1A1A1A]">{catDef.label}</h2>
          <p className="font-outfit text-[12px] text-[#6B6560]">
            {allItems.length} items · {formatAUD(total)}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-2">
          {allItems
            .sort((a, b) => b.date.getTime() - a.date.getTime())
            .map((item, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-[#EDE8DF] rounded-2xl border border-[#D4CEC4]">
                <div className="flex-1 min-w-0">
                  <p className="font-outfit text-[14px] font-medium text-[#1A1A1A] truncate">{item.name}</p>
                  <p className="font-outfit text-[11px] text-[#6B6560]">
                    {item.merchant} · {format(item.date, 'd MMM')}
                  </p>
                </div>
                <p className="font-serif text-[15px] text-[#1A1A1A]">{formatAUD(item.price)}</p>
              </div>
            ))}
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================
// SCAN RECEIPT SHEET
// ============================================================
function ScanReceiptSheet({
  onClose,
  onSaved,
  householdId,
  userId,
  userDisplayName,
  userPhotoURL,
}: {
  onClose: () => void;
  onSaved: () => void;
  householdId: string;
  userId: string;
  userDisplayName: string;
  userPhotoURL?: string;
}) {
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<Awaited<ReturnType<typeof scanReceipt>> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [imageURL, setImageURL] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setScanning(true);
    setError('');
    setImageURL(URL.createObjectURL(file));
    try {
      const result = await scanReceipt(file, householdId);
      setScanned(result);
    } catch (e: any) {
      setError(e.message || 'Could not read receipt');
    } finally {
      setScanning(false);
    }
  };

  const handleSave = async () => {
    if (!scanned || saving) return;
    setSaving(true);
    try {
      const now = new Date();
      const budgetMonth = format(now, 'yyyy-MM');

      // Upload image if available
      let savedImageURL = '';
      if (imageURL) {
        try {
          const file = cameraRef.current?.files?.[0] || galleryRef.current?.files?.[0];
          if (file) {
            const storageRef = ref(storage, `households/${householdId}/receipts/${Date.now()}_${file.name}`);
            await uploadBytes(storageRef, file);
            savedImageURL = await getDownloadURL(storageRef);
          }
        } catch (e) {
          // Storage unavailable (Spark plan) — continue without image
        }
      }

      const expenseDate = scanned.date ? new Date(scanned.date) : now;
      const finalDate = isNaN(expenseDate.getTime()) ? now : expenseDate;

      await addDoc(collection(db, `households/${householdId}/expenses`), {
        merchantName: scanned.merchantName,
        total: scanned.total,
        date: finalDate,
        category: scanned.lineItems[0]?.category || 'other',
        lineItems: scanned.lineItems,
        paidBy: userId,
        scannedBy: userId,
        scannedByName: userDisplayName,
        scannedByPhoto: userPhotoURL || null,
        imageURL: savedImageURL || null,
        budgetMonth,
        source: 'receipt_scan',
        createdAt: serverTimestamp(),
      });

      haptic.success();
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to save');
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] bg-[#1A1A1A]/60 backdrop-blur-sm flex items-end"
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={SPRING_DEFAULT}
        className="bg-[#fcf9f4] rounded-t-[28px] w-full max-h-[90dvh] flex flex-col"
      >
        <div className="px-6 pt-5 pb-4 flex items-center justify-between flex-shrink-0">
          <h2 className="font-serif text-[20px] text-[#1A1A1A]">Scan Receipt</h2>
          <button onClick={onClose} className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {/* Upload button */}
          {!scanned && !scanning && (
            <div className="grid grid-cols-1 gap-4">
              <label className="w-full bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl p-8 flex flex-col items-center gap-3 active:bg-[#E5E0D7] transition-colors cursor-pointer">
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ''; handleFile(f); } }}
                />
                <div className="w-12 h-12 rounded-full bg-white/50 flex items-center justify-center text-xl shadow-sm">
                  📷
                </div>
                <div className="text-center">
                  <p className="font-serif text-[17px] text-[#1A1A1A]">Use Camera</p>
                  <p className="font-outfit text-[12px] text-[#6B6560]">Take a new photo now</p>
                </div>
              </label>

              <label className="w-full bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl p-8 flex flex-col items-center gap-3 active:bg-[#E5E0D7] transition-colors cursor-pointer">
                <input
                  ref={galleryRef}
                  type="file"
                  accept="image/*"
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) { e.target.value = ''; handleFile(f); } }}
                />
                <div className="w-12 h-12 rounded-full bg-white/50 flex items-center justify-center text-xl shadow-sm">
                  🖼️
                </div>
                <div className="text-center">
                  <p className="font-serif text-[17px] text-[#1A1A1A]">Photo Library</p>
                  <p className="font-outfit text-[12px] text-[#6B6560]">Choose from your phone</p>
                </div>
              </label>
            </div>
          )}

          {/* Scanning */}
          {scanning && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 size={40} className="text-[#B8955A] animate-spin mb-4" />
              <p className="font-outfit text-[15px] text-[#6B6560]">Reading receipt with AI...</p>
              {imageURL && (
                <img src={imageURL} className="mt-4 rounded-xl max-h-40 object-contain opacity-50" alt="Receipt" />
              )}
            </div>
          )}

          {/* Results */}
          {scanned && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              {imageURL && (
                <div className="relative">
                  <img src={imageURL} className="rounded-2xl w-full max-h-48 object-contain bg-black/5" alt="Receipt" />
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-t from-black/20 to-transparent" />
                </div>
              )}

              {/* Summary card */}
              <div className="bg-[#1A1A1A] rounded-2xl p-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-[#B8955A] opacity-10 blur-2xl" />
                <p className="font-outfit text-[10px] uppercase tracking-[2px] text-[#B8955A] mb-1">Merchant</p>
                <h3 className="font-serif text-[20px] text-white mb-3">{scanned.merchantName}</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="font-outfit text-[9px] uppercase tracking-wider text-white/40">Subtotal</p>
                    <p className="font-serif text-[15px] text-white">{formatAUD((scanned as any).subtotal || scanned.total)}</p>
                  </div>
                  <div>
                    <p className="font-outfit text-[9px] uppercase tracking-wider text-white/40">Tax</p>
                    <p className="font-serif text-[15px] text-white">{formatAUD((scanned as any).tax || 0)}</p>
                  </div>
                  <div>
                    <p className="font-outfit text-[9px] uppercase tracking-wider text-white/40">Total</p>
                    <p className="font-serif text-[16px] text-[#B8955A] font-semibold">{formatAUD(scanned.total)}</p>
                  </div>
                </div>
              </div>

              {/* Line items with qty × unit price */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-outfit text-[10px] uppercase tracking-[2px] text-[#B8955A]">
                    {scanned.lineItems.length} Line Item{scanned.lineItems.length > 1 ? 's' : ''}
                  </p>
                  {/* Category breakdown mini chart */}
                  <div className="flex gap-1">
                    {Object.entries(
                      scanned.lineItems.reduce((acc: any, item) => {
                        acc[item.category] = (acc[item.category] || 0) + item.price;
                        return acc;
                      }, {})
                    ).slice(0, 3).map(([cat, amt]: any) => (
                      <span
                        key={cat}
                        className="font-outfit text-[9px] px-2 py-0.5 rounded-full text-white"
                        style={{ background: getCategoryDef(cat).color }}
                      >
                        {getCategoryDef(cat).emoji} {Math.round((amt / scanned.total) * 100)}%
                      </span>
                    ))}
                  </div>
                </div>

                {/* Column headers */}
                <div className="flex gap-2 px-3 py-1.5 bg-[#EDE8DF] rounded-t-xl border border-[#D4CEC4] border-b-0">
                  <span className="flex-1 font-outfit text-[10px] uppercase tracking-wider text-[#6B6560]">Item</span>
                  <span className="w-24 text-right font-outfit text-[10px] uppercase tracking-wider text-[#6B6560]">Qty × Unit</span>
                  <span className="w-16 text-right font-outfit text-[10px] uppercase tracking-wider text-[#6B6560]">Total</span>
                </div>

                <div className="bg-[#EDE8DF] rounded-b-xl border border-[#D4CEC4] border-t-0 overflow-hidden">
                  {scanned.lineItems.map((item, i) => {
                    const catDef = getCategoryDef(item.category);
                    const unitP = (item as any).unitPrice || item.price / (item.quantity || 1);
                    return (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className={`flex items-center gap-2 px-3 py-2.5 ${
                          i < scanned.lineItems.length - 1 ? 'border-b border-[#D4CEC4]/60' : ''
                        }`}
                      >
                        <span className="text-[14px] flex-shrink-0">{catDef.emoji}</span>
                        <span className="flex-1 font-outfit text-[12px] text-[#1A1A1A] truncate">{item.name}</span>
                        {(item.quantity || 1) > 1 ? (
                          <span className="w-24 text-right font-outfit text-[11px] text-[#6B6560]">
                            {item.quantity}×{formatAUD(unitP)}
                          </span>
                        ) : (
                          <span className="w-24 text-right font-outfit text-[11px] text-[#6B6560]">
                            {formatAUD(unitP)}
                          </span>
                        )}
                        <span className="w-16 text-right font-outfit text-[13px] text-[#1A1A1A] font-semibold">
                          {formatAUD(item.price)}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>
              </div>

              {error && (
                <p className="font-outfit text-[13px] text-[#C47B6A] bg-red-50 p-3 rounded-xl">{error}</p>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1 pb-2">
                <button
                  onClick={() => { setScanned(null); setImageURL(null); setError(''); }}
                  className="flex-1 h-12 rounded-full border border-[#D4CEC4] font-outfit text-[14px] text-[#6B6560]"
                >
                  Retake
                </button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 h-12 rounded-full bg-[#1A1A1A] text-white font-outfit text-[14px] font-semibold flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {saving ? 'Saving...' : 'Save Receipt'}
                </motion.button>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================
// MAIN FINANCES TAB
// ============================================================
export default function FinancesTab() {
  const { user, householdId, userData } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'explorer' | 'analytics'>('overview');
  const [viewMonth, setViewMonth] = useState(new Date());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [bankTransactions, setBankTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showScanSheet, setShowScanSheet] = useState(false);
  const [showBankImport, setShowBankImport] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [drillDownCat, setDrillDownCat] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [monthlyBudget, setMonthlyBudget] = useState(3000);
  const [partnerData, setPartnerData] = useState<any>(null);

  // ---- Data listeners ----
  useEffect(() => {
    if (!householdId) return;

    const unsubExpenses = onSnapshot(
      query(collection(db, `households/${householdId}/expenses`), orderBy('date', 'desc')),
      snap => {
        const data = snap.docs.map(d => {
          const raw = d.data();
          return {
            id: d.id,
            merchantName: raw.merchantName || 'Unknown',
            total: raw.total || 0,
            date: raw.date instanceof Timestamp ? raw.date.toDate() : new Date(raw.date),
            category: raw.category || 'other',
            lineItems: raw.lineItems || [],
            paidBy: raw.paidBy || '',
            source: raw.source || 'manual',
            imageURL: raw.imageURL || null,
            notes: raw.notes || '',
            budgetMonth: raw.budgetMonth || format(new Date(), 'yyyy-MM'),
            scannedBy: raw.scannedBy || null,
            scannedByName: raw.scannedByName || null,
            scannedByPhoto: raw.scannedByPhoto || null,
          } as Expense;
        });
        setExpenses(data);
        setLoading(false);
      }
    );

    const unsubBank = onSnapshot(
      query(collection(db, `households/${householdId}/bankTransactions`), orderBy('date', 'desc')),
      snap => {
        setBankTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    );

    return () => { unsubExpenses(); unsubBank(); };
  }, [householdId]);

  // Load monthly budget from Firestore (set in Settings)
  useEffect(() => {
    if (!householdId) return;
    const unsubBudget = onSnapshot(doc(db, 'households', householdId), (snap) => {
      const data = snap.data();
      const limit = data?.budgetSettings?.monthlyLimit;
      if (limit && typeof limit === 'number' && limit > 0) {
        setMonthlyBudget(limit);
      }
    });
    return () => unsubBudget();
  }, [householdId]);

  // ---- Derived data ----
  const monthKey = format(viewMonth, 'yyyy-MM');

  const monthExpenses = useMemo(() =>
    expenses.filter(e => e.budgetMonth === monthKey),
    [expenses, monthKey]
  );

  const totalSpent = useMemo(() =>
    monthExpenses.reduce((s, e) => s + e.total, 0),
    [monthExpenses]
  );

  const monthIncome = useMemo(() => {
    const incomes = bankTransactions.filter(t => {
      const tDate = t.date instanceof Timestamp ? t.date.toDate() : new Date(t.date);
      return format(tDate, 'yyyy-MM') === monthKey && t.type === 'credit' && t.incomeType !== 'transfer';
    });
    return incomes.reduce((s: number, t: any) => s + Math.abs(t.amount || 0), 0);
  }, [bankTransactions, monthKey]);

  const categoryTotals = useMemo(() => {
    const map: Record<string, number> = {};
    for (const exp of monthExpenses) {
      map[exp.category] = (map[exp.category] || 0) + exp.total;
    }
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amount]) => ({
        category: cat,
        amount,
        ...getCategoryDef(cat),
      }));
  }, [monthExpenses]);

  const donutData = useMemo(() =>
    categoryTotals.map(ct => ({ category: ct.category, amount: ct.amount, color: ct.color })),
    [categoryTotals]
  );

  const weeklyTotals = useMemo(() => {
    const start = startOfMonth(viewMonth);
    const weeks = [0, 0, 0, 0, 0];
    for (const exp of monthExpenses) {
      const weekIdx = Math.min(Math.floor((exp.date.getDate() - 1) / 7), 4);
      weeks[weekIdx] += exp.total;
    }
    return weeks.filter((_, i) => {
      const weekStart = new Date(start.getFullYear(), start.getMonth(), i * 7 + 1);
      return weekStart <= new Date();
    });
  }, [monthExpenses, viewMonth]);

  const budgetHealth = useMemo(() =>
    calculateBudgetHealth(monthlyBudget, totalSpent, monthIncome, 0),
    [monthlyBudget, totalSpent, monthIncome]
  );

  // All-time aggregates for ML
  const allTimeAggregates = useMemo(() => {
    const allData = expenses.map(e => ({
      amount: e.total,
      category: e.category,
      date: e.date,
      type: 'expense' as const,
    }));
    return buildMonthlyAggregates(allData);
  }, [expenses]);

  const categoryForecasts = useMemo(() =>
    forecastCategories(allTimeAggregates),
    [allTimeAggregates]
  );

  // Filtered expenses for Explorer
  const filteredExpenses = useMemo(() => {
    if (!searchQuery) return monthExpenses;
    const q = searchQuery.toLowerCase();
    return expenses.filter(e =>
      e.merchantName.toLowerCase().includes(q) ||
      e.lineItems.some(i => i.name.toLowerCase().includes(q))
    );
  }, [expenses, monthExpenses, searchQuery]);

  // Item search (all time)
  const itemSearchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase();
    const found: Array<{ name: string; merchant: string; price: number; date: Date }> = [];
    for (const e of expenses) {
      for (const item of e.lineItems) {
        if (item.name.toLowerCase().includes(q)) {
          found.push({ name: item.name, merchant: e.merchantName, price: item.price, date: e.date });
        }
      }
    }
    return found.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 30);
  }, [expenses, searchQuery]);

  // Top purchased items (all time)
  const topItems = useMemo(() => {
    const counts: Record<string, { count: number; total: number; avg: number; last: Date }> = {};
    for (const e of expenses) {
      for (const item of e.lineItems) {
        if (!counts[item.name]) counts[item.name] = { count: 0, total: 0, avg: 0, last: new Date(0) };
        counts[item.name].count++;
        counts[item.name].total += item.price;
        if (e.date > counts[item.name].last) counts[item.name].last = e.date;
      }
    }
    return Object.entries(counts)
      .map(([name, data]) => ({ name, ...data, avg: data.total / data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [expenses]);

  // Count-up hook values
  const displayTotal = useCurrencyCountUp(totalSpent, 0, !loading);
  const displayBudget = formatAUD(monthlyBudget);
  const budgetPct = monthlyBudget > 0 ? (totalSpent / monthlyBudget) * 100 : 0;

  const handleDeleteExpense = async (id: string) => {
    if (!householdId) return;
    if (!window.confirm('Delete this receipt?')) return;
    await deleteDoc(doc(db, `households/${householdId}/expenses`, id));
    haptic.light();
  };

  if (!householdId) return null;

  return (
    <div
      style={{
        height: 'calc(100dvh - 76px)',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: colors.linen,
        paddingBottom: 'calc(32px + env(safe-area-inset-bottom))',
      }}
      className="relative no-scrollbar"
    >
      {/* Header */}
      <div className="px-5 pt-14 pb-4">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-[32px] font-light text-[#1A1A1A]">Finances</h1>
          <div className="flex items-center gap-2">
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setShowMenu(true)}
              className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center border border-[#D4CEC4]"
            >
              <MoreHorizontal size={18} className="text-[#1A1A1A]" />
            </motion.button>
          </div>
        </div>

        {/* Month nav */}
        <div className="flex items-center gap-4 mt-2">
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => setViewMonth(m => subMonths(m, 1))}>
            <ChevronLeft size={20} className="text-[#6B6560]" />
          </motion.button>
          <span className="font-outfit text-[14px] text-[#1A1A1A] font-medium">
            {format(viewMonth, 'MMMM yyyy')}
          </span>
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setViewMonth(m => addMonths(m, 1))}
            disabled={viewMonth >= new Date()}
          >
            <ChevronRight size={20} className={viewMonth >= new Date() ? 'text-[#D4CEC4]' : 'text-[#6B6560]'} />
          </motion.button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-5 mb-4">
        <div className="flex gap-0 bg-[#EDE8DF] rounded-2xl p-1">
          {(['overview', 'explorer', 'analytics'] as const).map(tab => (
            <motion.button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2.5 rounded-xl font-outfit text-[13px] transition-colors relative ${
                activeTab === tab ? 'text-[#1A1A1A] font-semibold' : 'text-[#6B6560]'
              }`}
            >
              {activeTab === tab && (
                <motion.div
                  layoutId="finance-tab-indicator"
                  className="absolute inset-0 bg-[#fcf9f4] rounded-xl shadow-sm"
                  transition={SPRING_DEFAULT}
                />
              )}
              <span className="relative z-10 capitalize">{tab}</span>
            </motion.button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">

        {/* ============ TAB 1: OVERVIEW ============ */}
        {activeTab === 'overview' && (
          <motion.div key="overview" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>

            {/* Hero Card */}
            <div className="px-5 mb-4">
              <div className="bg-[#1A1A1A] rounded-[28px] p-6 relative overflow-hidden">
                {/* Aurora effect */}
                <div className="absolute inset-0 opacity-10 pointer-events-none">
                  <div className="absolute top-0 right-0 w-48 h-48 rounded-full bg-[#B8955A] blur-3xl" />
                  <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full bg-[#C47B6A] blur-2xl" />
                </div>

                <div className="relative z-10">
                  <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A] mb-1">
                    {format(viewMonth, 'MMMM yyyy')} · Spent
                  </p>
                  <p className="font-serif text-[48px] font-light text-white leading-none tracking-[-2px]">
                    {loading ? '...' : displayTotal}
                  </p>
                  <p className="font-outfit text-[13px] text-white/50 mt-1">
                    / {displayBudget} budget
                  </p>

                  {/* Budget bar */}
                  <div className="mt-4 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(budgetPct, 100)}%` }}
                      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
                      className="h-full rounded-full"
                      style={{ background: budgetHealth.color }}
                    />
                  </div>

                  {/* Mini stats */}
                  <div className="grid grid-cols-3 gap-4 mt-4">
                    <div>
                      <p className="font-outfit text-[10px] text-white/40 uppercase tracking-wider">Daily avg</p>
                      <p className="font-serif text-[16px] text-white">{formatCompact(totalSpent / Math.max(new Date().getDate(), 1))}</p>
                    </div>
                    <div>
                      <p className="font-outfit text-[10px] text-white/40 uppercase tracking-wider">Receipts</p>
                      <p className="font-serif text-[16px] text-white">{monthExpenses.length}</p>
                    </div>
                    <div>
                      <p className="font-outfit text-[10px] text-white/40 uppercase tracking-wider">Health</p>
                      <p className="font-serif text-[16px]" style={{ color: budgetHealth.color }}>{budgetHealth.score}</p>
                    </div>
                  </div>

                  {/* Cash flow (if income data) */}
                  {monthIncome > 0 && (
                    <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                      <span className="font-outfit text-[12px] text-white/50">Income</span>
                      <span className="font-outfit text-[13px] text-[#4CAF50]">{formatAUD(monthIncome)}</span>
                      <span className="font-outfit text-[12px] text-white/50">Saved</span>
                      <span className={`font-outfit text-[13px] ${monthIncome > totalSpent ? 'text-[#4CAF50]' : 'text-[#C47B6A]'}`}>
                        {formatAUD(Math.abs(monthIncome - totalSpent))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Category Donut */}
            {categoryTotals.length > 0 && (
              <div className="px-5 mb-4">
                <div className="bg-[#EDE8DF] border border-[#D4CEC4] rounded-[22px] p-5">
                  <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A] mb-4">By Category</p>
                  <div className="flex items-center gap-4">
                    <div className="flex-shrink-0">
                      <DonutChart data={donutData} total={totalSpent} onSliceClick={setDrillDownCat} />
                      <p className="font-outfit text-[10px] text-[#6B6560] text-center mt-1">tap to explore</p>
                    </div>
                    <div className="flex-1 space-y-2.5 overflow-hidden">
                      {categoryTotals.slice(0, 5).map(ct => (
                        <motion.button
                          key={ct.category}
                          whileTap={{ scale: 0.97 }}
                          onClick={() => setDrillDownCat(ct.category)}
                          className="w-full flex items-center gap-2 text-left"
                        >
                          <span className="text-[14px] flex-shrink-0">{ct.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="font-outfit text-[12px] text-[#1A1A1A] truncate">{ct.label}</span>
                              <span className="font-outfit text-[12px] text-[#6B6560] flex-shrink-0 ml-1">{formatCompact(ct.amount)}</span>
                            </div>
                            <div className="mt-1 h-1 bg-[#D4CEC4] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${totalSpent > 0 ? (ct.amount / totalSpent) * 100 : 0}%`, background: ct.color }}
                              />
                            </div>
                          </div>
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Weekly bars */}
            {weeklyTotals.length > 1 && (
              <div className="px-5 mb-4">
                <div className="bg-[#EDE8DF] border border-[#D4CEC4] rounded-[22px] p-5">
                  <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A] mb-3">Weekly Spend</p>
                  <WeeklyBarChart weeklyTotals={weeklyTotals} />
                  <div className="flex justify-between mt-1">
                    {weeklyTotals.map((_, i) => (
                      <span key={i} className="font-outfit text-[10px] text-[#6B6560]">Wk {i+1}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Empty state */}
            {monthExpenses.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
                <div className="w-16 h-16 rounded-full bg-[#EDE8DF] flex items-center justify-center mb-4 text-[28px]">🧾</div>
                <h3 className="font-serif text-[20px] text-[#1A1A1A] mb-2">No expenses yet</h3>
                <p className="font-outfit text-[13px] text-[#6B6560]">Scan a receipt to get started</p>
              </div>
            )}
          </motion.div>
        )}

        {/* ============ TAB 2: EXPLORER ============ */}
        {activeTab === 'explorer' && (
          <motion.div key="explorer" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>

            {/* Search */}
            <div className="px-5 mb-4">
              <div className="flex items-center gap-3 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl px-4 h-12">
                <Search size={16} className="text-[#6B6560] flex-shrink-0" />
                <input
                  type="text"
                  placeholder="Search items, receipts, merchants..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent border-none focus:ring-0 font-outfit text-[14px] text-[#1A1A1A] placeholder-[#A8A29E]"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')}>
                    <X size={14} className="text-[#6B6560]" />
                  </button>
                )}
              </div>
            </div>

            {/* Results */}
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={32} className="text-[#B8955A] animate-spin" />
              </div>
            ) : (
              <div className="px-5 space-y-3">
                {filteredExpenses.map(exp => (
                  <ReceiptCard
                    key={exp.id}
                    expense={exp}
                    isExpanded={expandedId === exp.id}
                    onToggle={() => setExpandedId(expandedId === exp.id ? null : exp.id)}
                    onDelete={() => handleDeleteExpense(exp.id)}
                    currentUserId={user?.uid || ''}
                    partnerData={partnerData}
                  />
                ))}

                {filteredExpenses.length === 0 && (
                  <div className="text-center py-12">
                    <p className="font-outfit text-[14px] text-[#6B6560]">No receipts found</p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {/* ============ TAB 3: ANALYTICS ============ */}
        {activeTab === 'analytics' && (
          <motion.div key="analytics" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>

            {/* Item search */}
            <div className="px-5 mb-5">
              <div className="flex items-center gap-3 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl px-4 h-14">
                <Search size={18} className="text-[#6B6560]" />
                <input
                  type="text"
                  placeholder="Search everything you've ever bought..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent border-none focus:ring-0 font-outfit text-[15px] text-[#1A1A1A] placeholder-[#A8A29E]"
                />
                {searchQuery && <button onClick={() => setSearchQuery('')}><X size={14} /></button>}
              </div>

              {/* Item search results */}
              <AnimatePresence>
                {itemSearchResults.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-2 space-y-2"
                  >
                    {itemSearchResults.map((item, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 bg-[#EDE8DF] rounded-xl border border-[#D4CEC4]">
                        <div className="flex-1 min-w-0">
                          <p className="font-outfit text-[13px] font-medium text-[#1A1A1A] truncate">{item.name}</p>
                          <p className="font-outfit text-[11px] text-[#6B6560]">{item.merchant} · {format(item.date, 'd MMM yyyy')}</p>
                        </div>
                        <p className="font-outfit text-[13px] text-[#1A1A1A]">{formatAUD(item.price)}</p>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Top purchased */}
            {topItems.length > 0 && (
              <div className="px-5 mb-5">
                <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A] mb-3">Most Purchased — All Time</p>
                <div className="space-y-3">
                  {topItems.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-3 p-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl">
                      <span className="font-serif text-[28px] text-[#B8955A] w-8 text-center leading-none">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-outfit text-[14px] font-medium text-[#1A1A1A] truncate">{item.name}</p>
                        <p className="font-outfit text-[12px] text-[#6B6560]">{item.count}× · avg {formatAUD(item.avg)}</p>
                        <div className="mt-1.5 h-1 bg-[#D4CEC4] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#B8955A] rounded-full"
                            style={{ width: `${(item.count / (topItems[0]?.count || 1)) * 100}%` }}
                          />
                        </div>
                      </div>
                      <p className="font-outfit text-[13px] text-[#6B6560]">{formatAUD(item.total)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ML Forecasts */}
            {categoryForecasts.length > 0 && (
              <div className="px-5 mb-5">
                <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A] mb-3">3-Month Forecast</p>
                <div className="space-y-3">
                  {categoryForecasts.slice(0, 5).map(cf => {
                    const catDef = getCategoryDef(cf.category);
                    const nextMonth = cf.forecasts[0] || 0;
                    const TrendIcon = cf.trend === 'increasing' ? TrendingUp : cf.trend === 'decreasing' ? TrendingDown : Minus;
                    const trendColor = cf.trend === 'increasing' ? '#C47B6A' : cf.trend === 'decreasing' ? '#4CAF50' : '#6B6560';
                    return (
                      <div key={cf.category} className="p-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-[16px]">{catDef.emoji}</span>
                            <span className="font-outfit text-[14px] font-medium text-[#1A1A1A]">{catDef.label}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <TrendIcon size={14} style={{ color: trendColor }} />
                            <span className="font-outfit text-[12px]" style={{ color: trendColor }}>
                              {cf.trend}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <p className="font-outfit text-[12px] text-[#6B6560]">Predicted next month</p>
                          <p className="font-serif text-[18px] text-[#1A1A1A]">{formatAUD(nextMonth)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {expenses.length === 0 && (
              <div className="flex flex-col items-center py-16 text-center px-8">
                <div className="text-[40px] mb-4">📊</div>
                <h3 className="font-serif text-[20px] text-[#1A1A1A] mb-2">No data yet</h3>
                <p className="font-outfit text-[13px] text-[#6B6560]">Scan some receipts to see analytics</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAB */}
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ ...SPRING_BOUNCY, delay: 0.5 }}
        whileTap={{ scale: 0.88 }}
        onClick={() => setShowScanSheet(true)}
        style={{
          position: 'fixed',
          bottom: '100px',
          right: '24px',
          zIndex: 90,
          width: '56px',
          height: '56px',
          borderRadius: '999px',
          background: '#1A1A1A',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 8px 32px rgba(26,26,26,0.25)',
          border: 'none',
        }}
      >
        <Plus size={24} />
      </motion.button>

      {/* Menu overlay */}
      <AnimatePresence>
        {showMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[190]"
              onClick={() => setShowMenu(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={SPRING_BOUNCY}
              className="fixed top-20 right-5 z-[200] bg-[#fcf9f4] border border-[#D4CEC4] rounded-2xl shadow-xl overflow-hidden"
            >
              {[
                { label: '📤 Import Bank Statement', action: () => { setShowMenu(false); setShowBankImport(true); } },
                {
                  label: '💰 Set Monthly Budget',
                  action: () => {
                    const val = prompt('Monthly budget (AUD):', monthlyBudget.toString());
                    if (val && !isNaN(parseInt(val)) && householdId) {
                      const num = parseInt(val);
                      setMonthlyBudget(num);
                      updateDoc(doc(db, 'households', householdId), {
                        'budgetSettings.monthlyLimit': num
                      }).catch(console.error);
                    }
                    setShowMenu(false);
                  }
                },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={item.action}
                  className="w-full px-5 py-3.5 font-outfit text-[14px] text-[#1A1A1A] text-left hover:bg-[#EDE8DF] transition-colors border-b border-[#D4CEC4] last:border-0"
                >
                  {item.label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Scan receipt sheet */}
      <AnimatePresence>
        {showScanSheet && user && (
          <ScanReceiptSheet
            onClose={() => setShowScanSheet(false)}
            onSaved={() => {}}
            householdId={householdId}
            userId={user.uid}
            userDisplayName={userData?.displayName || user.displayName || 'You'}
            userPhotoURL={userData?.photoURL || user.photoURL || undefined}
          />
        )}
      </AnimatePresence>

      {/* Bank import */}
      <AnimatePresence>
        {showBankImport && (
          <BankImportFlow
            onClose={() => setShowBankImport(false)}
            onImported={(count) => {
              setShowBankImport(false);
              if (count > 0) fireCelebration({ x: 0.5, y: 0.8 });
            }}
          />
        )}
      </AnimatePresence>

      {/* Category drill-down */}
      <AnimatePresence>
        {drillDownCat && (
          <CategoryDrillDown
            category={drillDownCat}
            expenses={expenses}
            onBack={() => setDrillDownCat(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
