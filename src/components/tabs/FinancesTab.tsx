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
  orderBy, doc, deleteDoc, Timestamp, getDoc, updateDoc, setDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { format, startOfMonth, subMonths, addMonths } from 'date-fns';
import { GoogleGenerativeAI } from '@google/generative-ai';

import { getCategoryDef, colors } from '../../design/tokens';
import { categorizeItem } from '../../lib/categorization';
import { useCurrencyCountUp, SPRING_DEFAULT, SPRING_BOUNCY, haptic, fireCelebration } from '../../lib/motion';
import { buildMonthlyAggregates, forecastCategories, calculateBudgetHealth, calculateSpendVelocity, detectRecurringTransactions, calculateSavingsMomentum, formatAUD, formatCompact } from '../../lib/cashflow';
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
  // Price history: item name → previous price
  const [priceHistory, setPriceHistory] = useState<Record<string, number>>({});

  const handleFile = async (file: File) => {
    setScanning(true);
    setError('');
    setImageURL(URL.createObjectURL(file));
    try {
      const result = await scanReceipt(file, householdId);
      setScanned(result);
      // Load previous prices for each scanned item
      const history: Record<string, number> = {};
      await Promise.all(result.lineItems.map(async (item) => {
        const key = item.name.trim().toLowerCase().replace(/\s+/g, '_');
        try {
          const snap = await getDoc(doc(db, `households/${householdId}/priceHistory`, key));
          if (snap.exists()) history[item.name] = snap.data().price;
        } catch { /* ignore */ }
      }));
      setPriceHistory(history);
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

      // Write latest price for each line item to priceHistory (upsert by item key)
      await Promise.all(scanned.lineItems.map(async (item) => {
        const key = item.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
        try {
          await setDoc(
            doc(db, `households/${householdId}/priceHistory`, key),
            { price: item.price, name: item.name, merchant: scanned.merchantName, updatedAt: serverTimestamp() },
            { merge: true }
          );
        } catch { /* ignore — non-critical */ }
      }));

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

          {/* Scan failed — visible error + retry */}
          {!scanning && !scanned && error && (
            <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
              <p className="font-outfit text-[14px] text-red-500 bg-red-50 px-4 py-3 rounded-2xl w-full">{error}</p>
              <button
                onClick={() => setError('')}
                className="font-outfit text-[14px] text-[#6B6560] underline"
              >
                Try again
              </button>
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
                    const prevPrice = priceHistory[item.name];
                    const priceDiff = prevPrice !== undefined ? item.price - prevPrice : null;
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
                        <div className="flex-1 min-w-0">
                          <span className="font-outfit text-[12px] text-[#1A1A1A] truncate block">{item.name}</span>
                          {priceDiff !== null && Math.abs(priceDiff) > 0.005 && (
                            <span className={`font-outfit text-[10px] font-medium ${priceDiff > 0 ? 'text-[#C47B6A]' : 'text-[#7FAF7B]'}`}>
                              {priceDiff > 0 ? '↑' : '↓'} {formatAUD(Math.abs(priceDiff))} vs last time
                            </span>
                          )}
                        </div>
                        {(item.quantity || 1) > 1 ? (
                          <span className="w-20 text-right font-outfit text-[11px] text-[#6B6560]">
                            {item.quantity}×{formatAUD(unitP)}
                          </span>
                        ) : (
                          <span className="w-20 text-right font-outfit text-[11px] text-[#6B6560]">
                            {formatAUD(unitP)}
                          </span>
                        )}
                        <span className="w-14 text-right font-outfit text-[13px] text-[#1A1A1A] font-semibold">
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
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month');
  const [viewMonth, setViewMonth] = useState(new Date());
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [bankTransactions, setBankTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showScanSheet, setShowScanSheet] = useState(false);
  const [showBankImport, setShowBankImport] = useState(false);
  const [showManualSheet, setShowManualSheet] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showAddGoalSheet, setShowAddGoalSheet] = useState(false);
  const [drillDownCat, setDrillDownCat] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [monthlyBudget, setMonthlyBudget] = useState(0);
  const [monthlyIncomeOverride, setMonthlyIncomeOverride] = useState(0);
  const [partnerData, setPartnerData] = useState<any>(null);
  const [savingsGoals, setSavingsGoals] = useState<any[]>([]);
  // Manual expense form
  const [manualMerchant, setManualMerchant] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualCategory, setManualCategory] = useState('other');
  const [manualDate, setManualDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  // Add goal form
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDeadline, setGoalDeadline] = useState('');

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

    const unsubGoals = onSnapshot(
      query(collection(db, `households/${householdId}/savingsGoals`), orderBy('currentAmount', 'desc')),
      snap => setSavingsGoals(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );

    return () => { unsubExpenses(); unsubBank(); unsubGoals(); };
  }, [householdId]);

  // Load budget + income from household (set in Settings)
  useEffect(() => {
    if (!householdId) return;
    const unsub = onSnapshot(doc(db, 'households', householdId), (snap) => {
      const data = snap.data();
      const limit = data?.budgetSettings?.monthlyLimit;
      if (limit && typeof limit === 'number' && limit > 0) setMonthlyBudget(limit);
      const income = data?.budgetSettings?.monthlyIncome;
      if (income && typeof income === 'number' && income > 0) setMonthlyIncomeOverride(income);
    });
    return () => unsub();
  }, [householdId]);

  // ---- Derived data ----
  const monthKey = format(viewMonth, 'yyyy-MM');

  // Days elapsed in the viewed month (accurate for past months too)
  const daysElapsed = useMemo(() => {
    const now = new Date();
    const isCurrentMonth = format(viewMonth, 'yyyy-MM') === format(now, 'yyyy-MM');
    return isCurrentMonth
      ? Math.max(now.getDate(), 1)
      : new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  }, [viewMonth]);

  const monthExpenses = useMemo(() =>
    expenses.filter(e => e.budgetMonth === monthKey),
    [expenses, monthKey]
  );

  const totalSpent = useMemo(() =>
    monthExpenses.reduce((s, e) => s + e.total, 0),
    [monthExpenses]
  );

  // Income: bank transactions first, fall back to household recurring income setting
  const monthIncome = useMemo(() => {
    const bankIncome = bankTransactions
      .filter(t => {
        const tDate = t.date instanceof Timestamp ? t.date.toDate() : new Date(t.date);
        return format(tDate, 'yyyy-MM') === monthKey && t.type === 'credit' && t.incomeType !== 'transfer';
      })
      .reduce((s: number, t: any) => s + Math.abs(t.amount || 0), 0);
    return bankIncome > 0 ? bankIncome : monthlyIncomeOverride;
  }, [bankTransactions, monthKey, monthlyIncomeOverride]);

  // Year-level aggregates for year view
  const yearExpenses = useMemo(() =>
    expenses.filter(e => e.budgetMonth?.startsWith(String(viewYear))),
    [expenses, viewYear]
  );

  const yearTotalSpent = useMemo(() =>
    yearExpenses.reduce((s, e) => s + e.total, 0),
    [yearExpenses]
  );

  const yearMonthlyTotals = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => {
      const key = `${viewYear}-${String(i + 1).padStart(2, '0')}`;
      const total = expenses.filter(e => e.budgetMonth === key).reduce((s, e) => s + e.total, 0);
      return { month: i, label: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i], total };
    });
    return months;
  }, [expenses, viewYear]);

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

  const spendVelocity = useMemo(() => {
    const now = viewMonth;
    const isCurrentMonth = format(now, 'yyyy-MM') === format(new Date(), 'yyyy-MM');
    if (!isCurrentMonth || monthlyBudget <= 0) return null;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return calculateSpendVelocity(totalSpent, monthlyBudget, new Date().getDate(), daysInMonth);
  }, [totalSpent, monthlyBudget, viewMonth]);

  const recurringCandidates = useMemo(() =>
    detectRecurringTransactions(expenses),
    [expenses]
  );

  const savingsMomentum = useMemo(() => {
    const goal = savingsGoals[0];
    if (!goal || !goal.targetAmount || !goal.targetDate) return null;
    const targetDate = goal.targetDate?.toDate ? goal.targetDate.toDate() : new Date(goal.targetDate);
    if (isNaN(targetDate.getTime())) return null;
    // Estimate monthly contribution from monthIncome savings rate
    const monthlyContrib = monthIncome > 0 ? Math.max(0, monthIncome - totalSpent) : 0;
    return {
      goal,
      momentum: calculateSavingsMomentum(goal.targetAmount, goal.currentAmount || 0, targetDate, monthlyContrib),
    };
  }, [savingsGoals, monthIncome, totalSpent]);

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
            {/* Month / Year toggle */}
            <div className="flex bg-[#EDE8DF] rounded-full p-0.5 border border-[#D4CEC4]">
              {(['month', 'year'] as const).map(mode => (
                <motion.button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1 rounded-full font-outfit text-[12px] font-medium transition-colors ${viewMode === mode ? 'bg-[#1A1A1A] text-white' : 'text-[#6B6560]'}`}
                >
                  {mode === 'month' ? 'Month' : 'Year'}
                </motion.button>
              ))}
            </div>
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setShowMenu(true)}
              className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center border border-[#D4CEC4]"
            >
              <MoreHorizontal size={18} className="text-[#1A1A1A]" />
            </motion.button>
          </div>
        </div>

        {/* Period nav */}
        {viewMode === 'month' ? (
          <div className="flex items-center gap-4 mt-2">
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setViewMonth(m => subMonths(m, 1))}>
              <ChevronLeft size={20} className="text-[#6B6560]" />
            </motion.button>
            <span className="font-outfit text-[14px] text-[#1A1A1A] font-medium flex-1 text-center">
              {format(viewMonth, 'MMMM yyyy')}
            </span>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setViewMonth(m => addMonths(m, 1))}
              disabled={format(viewMonth, 'yyyy-MM') >= format(new Date(), 'yyyy-MM')}
            >
              <ChevronRight size={20} className={format(viewMonth, 'yyyy-MM') >= format(new Date(), 'yyyy-MM') ? 'text-[#D4CEC4]' : 'text-[#6B6560]'} />
            </motion.button>
          </div>
        ) : (
          <div className="flex items-center gap-4 mt-2">
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setViewYear(y => y - 1)}>
              <ChevronLeft size={20} className="text-[#6B6560]" />
            </motion.button>
            <span className="font-outfit text-[14px] text-[#1A1A1A] font-medium flex-1 text-center">
              {viewYear}
            </span>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setViewYear(y => y + 1)}
              disabled={viewYear >= new Date().getFullYear()}
            >
              <ChevronRight size={20} className={viewYear >= new Date().getFullYear() ? 'text-[#D4CEC4]' : 'text-[#6B6560]'} />
            </motion.button>
          </div>
        )}
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
        {activeTab === 'overview' && viewMode === 'year' && (
          <motion.div key="year-overview" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            {/* Year hero */}
            <div className="px-5 mb-4">
              <div className="bg-[#1A1A1A] rounded-[28px] p-6 relative overflow-hidden">
                <div className="absolute inset-0 opacity-10 pointer-events-none">
                  <div className="absolute top-0 right-0 w-48 h-48 rounded-full bg-[#B8955A] blur-3xl" />
                </div>
                <div className="relative z-10">
                  <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A] mb-1">{viewYear} · Total Spend</p>
                  <p className="font-serif text-[48px] font-light text-white leading-none tracking-[-2px]">{formatAUD(yearTotalSpent)}</p>
                  <p className="font-outfit text-[13px] text-white/40 mt-1">{yearExpenses.length} receipts · avg {formatAUD(yearTotalSpent / 12)}/month</p>
                  {monthlyIncomeOverride > 0 && (
                    <div className="mt-4 pt-3 border-t border-white/10 grid grid-cols-3 gap-3">
                      <div>
                        <p className="font-outfit text-[10px] text-white/40 uppercase tracking-wider">Income</p>
                        <p className="font-serif text-[15px] text-[#7FAF7B]">{formatAUD(monthlyIncomeOverride * 12)}</p>
                      </div>
                      <div>
                        <p className="font-outfit text-[10px] text-white/40 uppercase tracking-wider">Spent</p>
                        <p className="font-serif text-[15px] text-white">{formatAUD(yearTotalSpent)}</p>
                      </div>
                      <div>
                        <p className="font-outfit text-[10px] text-white/40 uppercase tracking-wider">Saved</p>
                        <p className={`font-serif text-[15px] ${monthlyIncomeOverride * 12 > yearTotalSpent ? 'text-[#7FAF7B]' : 'text-[#C47B6A]'}`}>
                          {formatAUD(Math.abs(monthlyIncomeOverride * 12 - yearTotalSpent))}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 12-month bar chart */}
            <div className="px-5 mb-4">
              <div className="bg-[#EDE8DF] border border-[#D4CEC4] rounded-[22px] p-5">
                <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A] mb-4">Monthly Breakdown</p>
                <div className="space-y-2">
                  {yearMonthlyTotals.map((m) => {
                    const maxTotal = Math.max(...yearMonthlyTotals.map(x => x.total), 1);
                    const pct = (m.total / maxTotal) * 100;
                    const isCurrentMonth = m.month === new Date().getMonth() && viewYear === new Date().getFullYear();
                    return (
                      <div key={m.month} className="flex items-center gap-3">
                        <p className={`font-outfit text-[11px] w-8 flex-shrink-0 ${isCurrentMonth ? 'text-[#B8955A] font-semibold' : 'text-[#6B6560]'}`}>{m.label}</p>
                        <div className="flex-1 h-5 bg-[#D4CEC4] rounded-full overflow-hidden">
                          {m.total > 0 && (
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.6, delay: m.month * 0.04, ease: [0.16, 1, 0.3, 1] }}
                              className="h-full rounded-full"
                              style={{ background: isCurrentMonth ? '#B8955A' : '#1A1A1A' }}
                            />
                          )}
                        </div>
                        <p className="font-outfit text-[11px] w-16 text-right flex-shrink-0 text-[#1A1A1A]">
                          {m.total > 0 ? formatCompact(m.total) : '—'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {yearExpenses.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
                <div className="text-[40px] mb-4">📅</div>
                <h3 className="font-serif text-[20px] text-[#1A1A1A] mb-2">No data for {viewYear}</h3>
                <p className="font-outfit text-[13px] text-[#6B6560]">Scan some receipts to see your year summary</p>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'overview' && viewMode === 'month' && (
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
                      <p className="font-serif text-[16px] text-white">{formatCompact(totalSpent / daysElapsed)}</p>
                    </div>
                    <div>
                      <p className="font-outfit text-[10px] text-white/40 uppercase tracking-wider">Receipts</p>
                      <p className="font-serif text-[16px] text-white">{monthExpenses.length}</p>
                    </div>
                    <div>
                      <p className="font-outfit text-[10px] text-white/40 uppercase tracking-wider">Health</p>
                      <p className="font-serif text-[16px]" style={{ color: budgetHealth.color }}>{budgetHealth.label}</p>
                    </div>
                  </div>

                  {/* Cash flow row */}
                  {monthIncome > 0 ? (
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-outfit text-[11px] text-white/50">Income</span>
                        <span className="font-outfit text-[13px] font-semibold text-[#7FAF7B]">{formatAUD(monthIncome)}</span>
                      </div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-outfit text-[11px] text-white/50">Spent</span>
                        <span className="font-outfit text-[13px] text-white">{formatAUD(totalSpent)}</span>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-white/10">
                        <span className="font-outfit text-[11px] text-white/50">
                          {monthIncome > totalSpent ? 'Saved this month' : 'Overspend'}
                        </span>
                        <span className={`font-outfit text-[15px] font-semibold ${monthIncome > totalSpent ? 'text-[#7FAF7B]' : 'text-[#C47B6A]'}`}>
                          {monthIncome > totalSpent ? '+' : '-'}{formatAUD(Math.abs(monthIncome - totalSpent))}
                        </span>
                      </div>
                      {/* Savings rate bar */}
                      <div className="mt-3">
                        <div className="flex justify-between mb-1">
                          <span className="font-outfit text-[10px] text-white/40">Savings rate</span>
                          <span className="font-outfit text-[10px] text-white/60">
                            {monthIncome > 0 ? Math.round(Math.max(0, (monthIncome - totalSpent) / monthIncome * 100)) : 0}%
                          </span>
                        </div>
                        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(100, Math.max(0, (monthIncome - totalSpent) / monthIncome * 100))}%` }}
                            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
                            className="h-full rounded-full bg-[#7FAF7B]"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
                      <p className="font-outfit text-[11px] text-white/40">Set income in Settings for cash flow</p>
                      <span className="font-outfit text-[10px] text-[#B8955A] px-2 py-0.5 bg-[#B8955A]/20 rounded-full">Settings → Finances</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Spend Velocity Banner */}
            {spendVelocity && !spendVelocity.isOnTrack && (
              <div className="px-5 mb-4">
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-[#FFF3E0] border border-[#FF9800]/30 rounded-[18px] p-4 flex items-start gap-3"
                >
                  <span className="text-[18px] flex-shrink-0 mt-0.5">⚠️</span>
                  <div>
                    <p className="font-outfit text-[13px] font-semibold text-[#E65100]">
                      At this rate you'll overspend by {formatAUD(spendVelocity.overspendAmount)}
                    </p>
                    <p className="font-outfit text-[11px] text-[#BF360C] mt-0.5">
                      {formatAUD(spendVelocity.dailyRate)}/day · {spendVelocity.daysLeft} days left · projected {formatAUD(spendVelocity.projectedMonthEnd)}
                    </p>
                  </div>
                </motion.div>
              </div>
            )}
            {spendVelocity && spendVelocity.isOnTrack && spendVelocity.daysLeft > 0 && (
              <div className="px-5 mb-4">
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-[#E8F5E9] border border-[#4CAF50]/30 rounded-[18px] p-4 flex items-start gap-3"
                >
                  <span className="text-[18px] flex-shrink-0 mt-0.5">✅</span>
                  <div>
                    <p className="font-outfit text-[13px] font-semibold text-[#2E7D32]">
                      On track — {formatAUD(monthlyBudget - spendVelocity.projectedMonthEnd)} to spare
                    </p>
                    <p className="font-outfit text-[11px] text-[#388E3C] mt-0.5">
                      {formatAUD(spendVelocity.dailyRate)}/day · {spendVelocity.daysLeft} days left
                    </p>
                  </div>
                </motion.div>
              </div>
            )}

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

            {/* Savings Goals */}
            {savingsGoals.length > 0 && (
              <div className="px-5 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A]">Savings Goals</p>
                  <motion.button
                    whileTap={{ scale: 0.93 }}
                    onClick={() => setShowAddGoalSheet(true)}
                    className="font-outfit text-[12px] text-[#B8955A] font-semibold bg-[#EDE8DF] px-3 py-1 rounded-full"
                  >
                    + Add Goal
                  </motion.button>
                </div>
                <div className="space-y-3">
                  {savingsGoals.map((g: any) => {
                    const pct = g.targetAmount > 0 ? Math.min(100, (g.currentAmount / g.targetAmount) * 100) : 0;
                    const done = pct >= 100;
                    const targetDate = g.targetDate?.toDate ? g.targetDate.toDate() : g.targetDate ? new Date(g.targetDate) : null;
                    return (
                      <div key={g.id} className="bg-[#EDE8DF] border border-[#D4CEC4] rounded-[20px] p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-outfit text-[14px] font-semibold text-[#1A1A1A]">{g.title || g.name}</p>
                            {targetDate && (
                              <p className="font-outfit text-[11px] text-[#6B6560] mt-0.5">
                                Target: {format(targetDate, 'd MMM yyyy')}
                              </p>
                            )}
                          </div>
                          <span className={`font-outfit text-[11px] font-semibold px-2.5 py-1 rounded-full ${done ? 'bg-[#7FAF7B]/20 text-[#2E7D32]' : 'bg-[#B8955A]/15 text-[#B8955A]'}`}>
                            {done ? '🎉 Done!' : `${Math.round(pct)}%`}
                          </span>
                        </div>
                        <div className="h-2 bg-[#D4CEC4] rounded-full overflow-hidden mb-2">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                            className="h-full rounded-full"
                            style={{ background: done ? '#7FAF7B' : '#B8955A' }}
                          />
                        </div>
                        <div className="flex justify-between">
                          <p className="font-outfit text-[12px] text-[#6B6560]">{formatAUD(g.currentAmount || 0)} saved</p>
                          <p className="font-outfit text-[12px] text-[#6B6560]">Goal: {formatAUD(g.targetAmount)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {savingsGoals.length === 0 && !loading && (
              <div className="px-5 mb-4">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setShowAddGoalSheet(true)}
                  className="w-full p-5 bg-[#EDE8DF] border border-dashed border-[#B8955A]/40 rounded-[20px] flex flex-col items-center gap-2"
                >
                  <span className="text-[28px]">🎯</span>
                  <p className="font-outfit text-[14px] font-semibold text-[#1A1A1A]">Set a savings goal</p>
                  <p className="font-outfit text-[12px] text-[#6B6560]">Holiday, house deposit, emergency fund…</p>
                </motion.button>
              </div>
            )}

            {/* Empty state */}
            {monthExpenses.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-10 px-8 text-center">
                <div className="w-16 h-16 rounded-full bg-[#EDE8DF] flex items-center justify-center mb-4 text-[28px]">🧾</div>
                <h3 className="font-serif text-[20px] text-[#1A1A1A] mb-2">No expenses this month</h3>
                <p className="font-outfit text-[13px] text-[#6B6560]">Tap + to scan a receipt or add manually</p>
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

            {/* Savings Momentum — Feature 7 */}
            {savingsMomentum && (
              <div className="px-5 mb-5">
                <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A] mb-3">Savings Momentum</p>
                <div className="p-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-outfit text-[13px] font-medium text-[#1A1A1A]">{savingsMomentum.goal.title}</p>
                      <p className="font-outfit text-[11px] text-[#6B6560] mt-0.5">{savingsMomentum.momentum.message}</p>
                    </div>
                    <span className={`font-outfit text-[11px] px-2.5 py-1 rounded-full font-semibold ${
                      savingsMomentum.momentum.onTrack
                        ? 'bg-[#E8F5E9] text-[#2E7D32]'
                        : 'bg-[#FFF3E0] text-[#E65100]'
                    }`}>
                      {savingsMomentum.momentum.onTrack ? '✓ On track' : '⚠ Behind'}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-2 bg-[#D4CEC4] rounded-full overflow-hidden mb-2">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (savingsMomentum.goal.currentAmount / savingsMomentum.goal.targetAmount) * 100)}%` }}
                      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
                      className="h-full rounded-full"
                      style={{ background: savingsMomentum.momentum.onTrack ? '#7FAF7B' : '#B8955A' }}
                    />
                  </div>
                  <div className="flex justify-between">
                    <p className="font-outfit text-[11px] text-[#6B6560]">{formatAUD(savingsMomentum.goal.currentAmount || 0)} saved</p>
                    <p className="font-outfit text-[11px] text-[#6B6560]">Goal: {formatAUD(savingsMomentum.goal.targetAmount)}</p>
                  </div>
                  <div className="mt-3 pt-3 border-t border-[#D4CEC4] grid grid-cols-2 gap-3">
                    <div>
                      <p className="font-outfit text-[9px] uppercase tracking-wider text-[#6B6560]">Need/month</p>
                      <p className="font-serif text-[16px] text-[#1A1A1A]">{formatAUD(savingsMomentum.momentum.requiredMonthly)}</p>
                    </div>
                    <div>
                      <p className="font-outfit text-[9px] uppercase tracking-wider text-[#6B6560]">Saving/month</p>
                      <p className="font-serif text-[16px]" style={{ color: savingsMomentum.momentum.onTrack ? '#7FAF7B' : '#C47B6A' }}>
                        {formatAUD(savingsMomentum.momentum.currentMonthly)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Recurring Subscriptions — Feature 5 */}
            {recurringCandidates.length > 0 && (
              <div className="px-5 mb-5">
                <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A] mb-3">Detected Subscriptions</p>
                <div className="space-y-2">
                  {recurringCandidates.slice(0, 5).map((r, i) => (
                    <div key={i} className="flex items-center gap-3 p-3.5 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl">
                      <div className="w-9 h-9 rounded-xl bg-white/60 flex items-center justify-center flex-shrink-0">
                        <span className="text-[16px]">🔄</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-outfit text-[13px] font-medium text-[#1A1A1A] truncate">{r.merchantName}</p>
                        <p className="font-outfit text-[11px] text-[#6B6560]">
                          Every ~{Math.round(r.averageIntervalDays)}d · {r.occurrences}× detected
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-outfit text-[13px] font-semibold text-[#1A1A1A]">{formatAUD(r.averageAmount)}</p>
                        <p className="font-outfit text-[10px]" style={{ color: r.confidence === 'high' ? '#7FAF7B' : '#B8955A' }}>
                          {r.confidence} confidence
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Real Cash Flow — Feature 8 */}
            {allTimeAggregates.length >= 2 && (
              <div className="px-5 mb-5">
                <p className="font-outfit text-[11px] uppercase tracking-[2.5px] text-[#B8955A] mb-3">Monthly Cash Flow</p>
                <div className="bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl p-4">
                  <div className="space-y-2">
                    {allTimeAggregates.slice(-6).map((m, i) => {
                      const isPositive = m.cashFlow >= 0;
                      const maxAbs = Math.max(...allTimeAggregates.slice(-6).map(x => Math.abs(x.cashFlow)), 1);
                      const pct = (Math.abs(m.cashFlow) / maxAbs) * 100;
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <p className="font-outfit text-[11px] text-[#6B6560] w-10 flex-shrink-0">
                            {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m.month - 1]}
                          </p>
                          <div className="flex-1 h-5 bg-[#D4CEC4] rounded-full overflow-hidden relative">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.7, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                              className="h-full rounded-full"
                              style={{ background: isPositive ? '#7FAF7B' : '#C47B6A' }}
                            />
                          </div>
                          <p className={`font-outfit text-[11px] w-16 text-right flex-shrink-0 ${isPositive ? 'text-[#2E7D32]' : 'text-[#C47B6A]'}`}>
                            {isPositive ? '+' : ''}{formatCompact(m.cashFlow)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="font-outfit text-[10px] text-[#6B6560] mt-3 text-center">
                    Income minus expenses — green = surplus, red = deficit
                  </p>
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
                { label: '✍️ Add Expense Manually', action: () => { setShowMenu(false); setShowManualSheet(true); } },
                { label: '📤 Import Bank Statement', action: () => { setShowMenu(false); setShowBankImport(true); } },
                { label: '🎯 Add Savings Goal', action: () => { setShowMenu(false); setShowAddGoalSheet(true); } },
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

      {/* ── Manual Expense Sheet ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showManualSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-[#1A1A1A]/60 backdrop-blur-sm flex items-end"
            onClick={() => setShowManualSheet(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={SPRING_DEFAULT}
              className="bg-[#fcf9f4] rounded-t-[28px] w-full max-h-[85dvh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-5 pb-4 flex items-center justify-between flex-shrink-0">
                <h2 className="font-serif text-[20px] text-[#1A1A1A]">Add Expense</h2>
                <button onClick={() => setShowManualSheet(false)} className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-8 space-y-4">
                <input
                  autoFocus
                  placeholder="Merchant / description"
                  value={manualMerchant}
                  onChange={(e) => setManualMerchant(e.target.value)}
                  className="w-full h-14 px-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl font-outfit text-[16px] text-[#1A1A1A] outline-none focus:border-[#B8955A]"
                />
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-outfit text-[16px] text-[#1A1A1A]">$</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={manualAmount}
                    onChange={(e) => setManualAmount(e.target.value)}
                    className="w-full h-14 pl-8 pr-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl font-outfit text-[16px] text-[#1A1A1A] outline-none focus:border-[#B8955A]"
                  />
                </div>
                <div>
                  <label className="font-outfit text-[11px] uppercase tracking-wider text-[#6B6560] mb-1.5 block">Category</label>
                  <select
                    value={manualCategory}
                    onChange={(e) => setManualCategory(e.target.value)}
                    className="w-full h-12 px-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl font-outfit text-[14px] text-[#1A1A1A] outline-none"
                  >
                    {['groceries','dining','transport','entertainment','health','shopping','utilities','rent','other'].map(c => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-outfit text-[11px] uppercase tracking-wider text-[#6B6560] mb-1.5 block">Date</label>
                  <input
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full h-12 px-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl font-outfit text-[14px] text-[#1A1A1A] outline-none"
                  />
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={async () => {
                    if (!manualMerchant.trim() || !manualAmount || !householdId || !user) return;
                    const expDate = manualDate ? new Date(manualDate) : new Date();
                    await addDoc(collection(db, `households/${householdId}/expenses`), {
                      merchantName: manualMerchant.trim(),
                      total: parseFloat(manualAmount),
                      date: expDate,
                      category: manualCategory,
                      lineItems: [],
                      paidBy: user.uid,
                      source: 'manual',
                      budgetMonth: format(expDate, 'yyyy-MM'),
                      createdAt: serverTimestamp(),
                    });
                    setManualMerchant('');
                    setManualAmount('');
                    setManualCategory('other');
                    setManualDate(format(new Date(), 'yyyy-MM-dd'));
                    setShowManualSheet(false);
                  }}
                  className="w-full h-14 bg-[#1A1A1A] text-white rounded-full font-outfit font-semibold text-[15px]"
                >
                  Add Expense
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Add Savings Goal Sheet ───────────────────────────────────────── */}
      <AnimatePresence>
        {showAddGoalSheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-[#1A1A1A]/60 backdrop-blur-sm flex items-end"
            onClick={() => setShowAddGoalSheet(false)}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={SPRING_DEFAULT}
              className="bg-[#fcf9f4] rounded-t-[28px] w-full max-h-[85dvh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 pt-5 pb-4 flex items-center justify-between flex-shrink-0">
                <h2 className="font-serif text-[20px] text-[#1A1A1A]">New Savings Goal</h2>
                <button onClick={() => setShowAddGoalSheet(false)} className="w-10 h-10 rounded-full bg-[#EDE8DF] flex items-center justify-center">
                  <X size={18} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-8 space-y-4">
                <input
                  autoFocus
                  placeholder="Goal name (e.g. Holiday, House deposit)"
                  value={goalName}
                  onChange={(e) => setGoalName(e.target.value)}
                  className="w-full h-14 px-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl font-outfit text-[15px] text-[#1A1A1A] outline-none focus:border-[#B8955A]"
                />
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-outfit text-[16px] text-[#1A1A1A]">$</span>
                  <input
                    type="number"
                    placeholder="Target amount"
                    value={goalTarget}
                    onChange={(e) => setGoalTarget(e.target.value)}
                    className="w-full h-14 pl-8 pr-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl font-outfit text-[16px] text-[#1A1A1A] outline-none focus:border-[#B8955A]"
                  />
                </div>
                <div>
                  <label className="font-outfit text-[11px] uppercase tracking-wider text-[#6B6560] mb-1.5 block">Target Date (optional)</label>
                  <input
                    type="date"
                    value={goalDeadline}
                    onChange={(e) => setGoalDeadline(e.target.value)}
                    className="w-full h-12 px-4 bg-[#EDE8DF] border border-[#D4CEC4] rounded-2xl font-outfit text-[14px] text-[#1A1A1A] outline-none"
                  />
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={async () => {
                    if (!goalName.trim() || !goalTarget || !householdId) return;
                    await addDoc(collection(db, `households/${householdId}/savingsGoals`), {
                      title: goalName.trim(),
                      targetAmount: parseFloat(goalTarget),
                      currentAmount: 0,
                      targetDate: goalDeadline ? new Date(goalDeadline) : null,
                      createdAt: serverTimestamp(),
                    });
                    setGoalName('');
                    setGoalTarget('');
                    setGoalDeadline('');
                    setShowAddGoalSheet(false);
                  }}
                  className="w-full h-14 bg-[#1A1A1A] text-white rounded-full font-outfit font-semibold text-[15px]"
                >
                  Create Goal
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
