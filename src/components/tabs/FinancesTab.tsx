import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Plus, 
  ChevronRight, 
  Trash2, 
  Loader2, 
  AlertCircle,
  Search,
  X,
  TrendingUp,
  ShoppingCart,
  UtensilsCrossed,
  Car,
  Heart,
  MoreHorizontal,
  Receipt
} from 'lucide-react';
import { useAuth } from '../AuthWrapper';
import { db, storage } from '../../firebase';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  orderBy, 
  limit, 
  doc, 
  updateDoc,
  setDoc,
  where,
  getDocs,
  increment,
  Timestamp,
  deleteDoc
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import confetti from 'canvas-confetti';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { GoogleGenerativeAI } from "@google/generative-ai";
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import SplitType from 'split-type';

// --- Constants & Types ---

const CATEGORIES = [
  { id: 'groceries', name: 'Groceries', icon: ShoppingCart },
  { id: 'dining', name: 'Dining', icon: UtensilsCrossed },
  { id: 'transport', name: 'Transport', icon: Car },
  { id: 'health', name: 'Health', icon: Heart },
  { id: 'entertainment', name: 'Entertainment', icon: MoreHorizontal },
  { id: 'utilities', name: 'Utilities', icon: MoreHorizontal },
  { id: 'shopping', name: 'Shopping', icon: ShoppingCart },
  { id: 'other', name: 'Other', icon: MoreHorizontal },
];

const categoryIcons: Record<string, any> = {
  groceries: ShoppingCart,
  dining: UtensilsCrossed,
  transport: Car,
  health: Heart,
  entertainment: MoreHorizontal,
  utilities: MoreHorizontal,
  shopping: ShoppingCart,
  bakery: ShoppingCart,
  meat: ShoppingCart,
  produce: ShoppingCart,
  frozen: ShoppingCart,
  drinks: UtensilsCrossed,
  household: ShoppingCart,
  snacks: ShoppingCart,
  pantry: ShoppingCart,
  other: MoreHorizontal,
};

const MERCHANT_RULES = {
  groceries: ["woolworths", "coles", "aldi", "iga", "harris farm", "costco", "foodworks"],
  dining: ["mcdonald", "kfc", "hungry jacks", "subway", "domino", "pizza", "cafe", "restaurant", "bistro"],
  transport: ["shell", "bp", "ampol", "7-eleven", "uber", "ola", "didi", "opal"],
  health: ["chemist warehouse", "priceline", "terry white", "blooms", "pharmacy", "medical", "dental", "doctor"],
  entertainment: ["cinema", "event", "ticketek", "ticketmaster", "hoyts", "village"],
  utilities: ["agl", "origin energy", "optus", "telstra", "vodafone", "sydney water", "ausgrid"],
  shopping: ["kmart", "target", "big w", "myer", "david jones", "uniqlo", "cotton on", "jb hi-fi", "harvey norman"],
};

const ITEM_RULES = [
  { keywords: ["milk", "cream", "butter", "cheese", "yogurt", "dairy"], category: "dairy", subcategory: "dairy" },
  { keywords: ["bread", "roll", "bun", "loaf", "croissant", "bagel"], category: "bakery", subcategory: "bread" },
  { keywords: ["chicken", "beef", "lamb", "pork", "mince", "steak", "sausage"], category: "meat", subcategory: "meat" },
  { keywords: ["apple", "banana", "orange", "grape", "berry", "mango", "avocado", "tomato", "lettuce", "carrot", "broccoli", "onion", "potato", "pumpkin"], category: "produce", subcategory: "fresh" },
  { keywords: ["frozen", "ice cream"], category: "frozen", subcategory: "frozen" },
  { keywords: ["water", "juice", "cola", "coffee", "tea", "drink", "beer", "wine", "spirit"], category: "drinks", subcategory: "beverages" },
  { keywords: ["shampoo", "soap", "deodorant", "toothpaste", "toilet", "paper", "tissue", "detergent", "cleaner"], category: "household", subcategory: "cleaning" },
  { keywords: ["chip", "chocolate", "biscuit", "lolly", "candy", "snack", "cake", "muffin"], category: "snacks", subcategory: "snacks" },
  { keywords: ["pasta", "rice", "flour", "oil", "sauce", "tin", "can", "jar"], category: "pantry", subcategory: "pantry" },
];

const normalizeDate = (date: any): Date => {
  if (!date) return new Date();
  if (typeof date === 'string') return new Date(date);
  if (date.toDate) return date.toDate();
  return new Date(date);
};

interface ReceiptItem {
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  category: string;
  subcategory: string;
  from_cache?: boolean;
  needs_category_confirm?: boolean;
}

interface ExtractionResult {
  merchant_name: string;
  merchant_address: string;
  date: string;
  time: string;
  receipt_number: string;
  payment_method: string;
  items: ReceiptItem[];
  subtotal: number;
  tax_gst: number;
  discount: number;
  total: number;
  currency: string;
  is_receipt: boolean;
  confidence: number;
}

interface Expense {
  id: string;
  merchant_name: string;
  merchant_category: string;
  merchant_address?: string;
  date: string; // YYYY-MM-DD
  time: string;
  receipt_number: string;
  payment_method: string;
  subtotal: number;
  tax_gst: number;
  discount: number;
  total: number;
  currency: string;
  items: ReceiptItem[];
  receiptURL?: string;
  status: "processing" | "needs_review" | "confirmed" | "failed";
  duplicateIds?: string[];
  paidBy: string;
  createdAt: any;
  source: string;
  tempId?: string;
}

interface CategoryCacheItem {
  item_name: string;
  category: string;
  subcategory: string;
  merchant_category: string;
  last_used: any;
  use_count: number;
}

// --- Utilities ---

const normaliseItemName = (name: string) => {
  return name
    .toLowerCase()
    .replace(/\d+g|\d+ml|\d+kg|\d+l|\d+pk/g, '') // remove sizes
    .replace(/[^a-z\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
};

const getMerchantCategory = (merchantName: string) => {
  const lower = merchantName.toLowerCase();
  for (const [category, keywords] of Object.entries(MERCHANT_RULES)) {
    if (keywords.some(kw => lower.includes(kw))) return category;
  }
  return "other";
};

const applyItemRules = (itemName: string) => {
  const lower = itemName.toLowerCase();
  for (const rule of ITEM_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return { category: rule.category, subcategory: rule.subcategory };
    }
  }
  return { category: "other", subcategory: "other" };
};

// --- Components ---

export default function FinancesTab() {
  const { user, householdId } = useAuth();
  
  // Refs
  const amountRef = useRef<HTMLSpanElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  // UI State
  const [isActionSheetOpen, setIsActionSheetOpen] = useState(false);
  const [isReviewSheetOpen, setIsReviewSheetOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  
  // Data State
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [receiptData, setReceiptData] = useState<Expense | null>(null);
  const [receiptPhotoURL, setReceiptPhotoURL] = useState<string | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  // --- Derived Data ---

  const totalMonthlySpend = useMemo(() => {
    const start = startOfMonth(new Date());
    const end = endOfMonth(new Date());
    return expenses
      .filter(e => {
        const d = normalizeDate(e.date);
        return d >= start && d <= end;
      })
      .reduce((sum, e) => sum + (Number(e.total) || 0), 0);
  }, [expenses]);

  // Digit flip animation for monthly spend
  useEffect(() => {
    if (!amountRef.current) return;
    const split = new SplitType(amountRef.current, { types: 'chars' });
    gsap.from(split.chars, {
      yPercent: 100,
      opacity: 0,
      duration: 0.5,
      stagger: 0.04,
      ease: 'power4.out',
      delay: 0.2
    });
    return () => split.revert();
  }, [totalMonthlySpend]);

  // If still saving after 10 seconds something is wrong
  useEffect(() => {
    if (!isSaving) return;
    const timeout = setTimeout(() => {
      setIsSaving(false);
      alert("Save is taking too long. Please try again.");
    }, 10000);
    return () => clearTimeout(timeout);
  }, [isSaving]);

  // --- Firestore Listeners ---

  useEffect(() => {
    if (!householdId) return;
    const expensesRef = collection(db, "households", householdId, "expenses");
    const q = query(expensesRef, orderBy("date", "desc"), limit(50));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newExpenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense));
      setExpenses(newExpenses);
      setIsLoading(false);
    });
    
    return () => unsubscribe();
  }, [householdId]);

  const categoryBreakdown = useMemo(() => {
    const totals: Record<string, number> = {};
    expenses.forEach(e => {
      const amount = Number(e.total) || 0;
      totals[e.merchant_category] = (totals[e.merchant_category] || 0) + amount;
    });
    return CATEGORIES.map(cat => ({
      ...cat,
      total: totals[cat.id] || 0
    })).filter(c => c.total > 0);
  }, [expenses]);

  const budget = 3000;
  const spendPercentage = Math.min((totalMonthlySpend / budget) * 100, 100);

  useGSAP(() => {
    if (progressBarRef.current) {
      gsap.fromTo(progressBarRef.current, 
        { width: "0%" }, 
        { width: `${spendPercentage}%`, duration: 1.5, ease: "power2.out" }
      );
    }
  }, [spendPercentage, isLoading]);

  // --- Handlers ---

  const handleTakePhoto = () => {
    cameraInputRef.current?.click();
    setIsActionSheetOpen(false);
  };

  const handleChooseFromLibrary = () => {
    galleryInputRef.current?.click();
    setIsActionSheetOpen(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !householdId) return;

    const tempId = `temp_${Date.now()}`;
    const optimisticReceipt: Expense = {
      id: tempId,
      status: "processing",
      merchant_name: "Scanning...",
      merchant_category: "other",
      total: 0,
      subtotal: 0,
      tax_gst: 0,
      discount: 0,
      currency: "AUD",
      items: [],
      date: new Date().toISOString().split('T')[0],
      time: "",
      receipt_number: "",
      payment_method: "unknown",
      createdAt: new Date(),
      paidBy: user?.uid || "unknown",
      source: "receipt_scan",
      tempId
    };

    // Step 1 — Instant optimistic add
    setExpenses(prev => [optimisticReceipt, ...prev]);
    setIsActionSheetOpen(false);
    
    // Step 2 — Process in background
    processReceiptInBackground(file, tempId);
  };

  const processReceiptInBackground = async (photoFile: File, tempId: string) => {
    try {
      // 1. Convert to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(photoFile);
      });
      const base64Data = await base64Promise;

      // 2. Call Gemini — only for extraction
      const extracted = await extractWithGemini(base64Data, photoFile.type);

      // 3. Apply local category cache — NO AI needed for this
      const categorised = await applyCategoryCache(extracted);

      // 4. Check for duplicates — algorithm, not AI
      const duplicates = await checkDuplicates(categorised);

      // 5. Save to Firestore
      const docRef = await addDoc(
        collection(db, "households", householdId!, "expenses"),
        {
          ...categorised,
          status: "needs_review",
          duplicateIds: duplicates.map(d => d.id),
          tempId,
          createdAt: serverTimestamp(),
          paidBy: user?.uid || "unknown",
          source: "receipt_scan"
        }
      );

      // 6. Upload photo in background
      uploadPhotoInBackground(photoFile, docRef.id);

      // 7. Replace optimistic item with real data
      setExpenses(prev => prev.map(e =>
        e.id === tempId ? { 
          ...categorised, 
          id: docRef.id, 
          status: "needs_review", 
          createdAt: Timestamp.now(),
          paidBy: user?.uid || "unknown",
          source: "receipt_scan"
        } as Expense : e
      ));

      // 8. Show subtle toast notification
      showToast(`Receipt from ${categorised.merchant_name} added — tap to review`);

    } catch (err) {
      console.error("Background processing failed:", err);
      // Mark as failed
      setExpenses(prev => prev.map(e =>
        e.id === tempId ? { ...e, status: "failed" } as Expense : e
      ));
      showToast("Receipt scan failed — tap to retry");
    }
  };

  const extractWithGemini = async (base64Data: string, mimeType: string): Promise<ExtractionResult> => {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `Extract receipt data. Return ONLY valid JSON, no markdown, no explanation:
    {
      "merchant_name": "exact store name as printed",
      "merchant_address": "if visible",
      "date": "YYYY-MM-DD",
      "time": "HH:MM",
      "receipt_number": "if visible",
      "payment_method": "card|cash|unknown",
      "items": [
        {
          "name": "exact item name as printed",
          "quantity": 1,
          "unit_price": 0.00,
          "total_price": 0.00
        }
      ],
      "subtotal": 0.00,
      "tax_gst": 0.00,
      "discount": 0.00,
      "total": 0.00,
      "currency": "AUD",
      "is_receipt": true,
      "confidence": 0.95
    }`;

    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { data: base64Data, mimeType } }
    ]);
    
    const text = result.response.text();
    const cleanJson = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleanJson) as ExtractionResult;
  };

  const applyCategoryCache = async (extracted: ExtractionResult) => {
    if (!householdId) return extracted;

    // Load entire cache once — it's small
    const cacheSnap = await getDocs(collection(db, "households", householdId, "categoryCache"));
    const cache: Record<string, CategoryCacheItem> = {};
    cacheSnap.forEach(doc => { cache[doc.id] = doc.data() as CategoryCacheItem; });

    // Apply merchant-level categorisation
    const merchantCategory = getMerchantCategory(extracted.merchant_name);

    // Apply item-level categorisation from cache
    const categorisedItems = extracted.items.map(item => {
      const key = normaliseItemName(item.name);
      const cached = cache[key];
      if (cached) {
        return {
          ...item,
          category: cached.category,
          subcategory: cached.subcategory,
          from_cache: true
        };
      }
      // Not in cache — use rule-based categorisation
      const ruledCategory = applyItemRules(item.name);
      return {
        ...item,
        category: ruledCategory.category,
        subcategory: ruledCategory.subcategory,
        from_cache: false,
        needs_category_confirm: true
      };
    });

    return { 
      ...extracted, 
      merchant_category: merchantCategory, 
      items: categorisedItems 
    };
  };

  const checkDuplicates = async (receipt: any) => {
    if (!householdId) return [];
    
    // Query expenses from last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const q = query(
      collection(db, "households", householdId, "expenses"),
      where("createdAt", ">=", Timestamp.fromDate(sevenDaysAgo)),
      orderBy("createdAt", "desc")
    );
    
    const recentSnap = await getDocs(q);
    const duplicates: any[] = [];
    
    recentSnap.forEach(doc => {
      const existing = doc.data();
      // Duplicate if: same merchant AND total within $0.50 AND within 7 days
      const sameMerchant = existing.merchant_name?.toLowerCase() === receipt.merchant_name?.toLowerCase();
      const similarTotal = Math.abs(existing.total - receipt.total) < 0.50;
      if (sameMerchant && similarTotal) {
        duplicates.push({ id: doc.id, ...existing });
      }
    });
    
    return duplicates;
  };

  const uploadPhotoInBackground = async (file: File, expenseId: string) => {
    if (!householdId) return;
    try {
      const storageRef = ref(storage, `households/${householdId}/receipts/${expenseId}_receipt.jpg`);
      const uploadResult = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(uploadResult.ref);
      await updateDoc(doc(db, "households", householdId, "expenses", expenseId), {
        receiptURL: url
      });
    } catch (err) {
      console.error("Background upload failed:", err);
    }
  };

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  };

  const saveToCategoryCache = async (itemName: string, category: string, subcategory: string, merchantCategory: string) => {
    if (!householdId) return;
    const key = normaliseItemName(itemName);
    await setDoc(
      doc(db, "households", householdId, "categoryCache", key),
      {
        item_name: key,
        category,
        subcategory,
        merchant_category: merchantCategory,
        last_used: serverTimestamp(),
        use_count: increment(1)
      },
      { merge: true }
    );
  };

  // --- Computed State ---
  const filteredExpenses = useMemo(() => {
    if (!searchQuery) return expenses;
    const lower = searchQuery.toLowerCase();
    return expenses.filter(e => 
      e.merchant_name.toLowerCase().includes(lower) ||
      e.items.some(item => item.name.toLowerCase().includes(lower))
    );
  }, [expenses, searchQuery]);

  const itemInsights = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return null;
    const lower = searchQuery.toLowerCase();
    
    // Search across ALL line items in ALL expenses
    const results: any[] = [];
    expenses.forEach(expense => {
      expense.items?.forEach(item => {
        if (item.name.toLowerCase().includes(lower)) {
          results.push({
            ...item,
            merchant: expense.merchant_name,
            date: expense.date,
            expenseId: expense.id
          });
        }
      });
    });

    if (results.length === 0) return null;

    const totalQty = results.reduce((sum, i) => sum + (i.quantity || 1), 0);
    const totalSpend = results.reduce((sum, i) => sum + (i.total_price || 0), 0);
    const avgPrice = totalSpend / totalQty;
    const avgPricePerUnit = totalSpend / results.length;

    // Price trend — compare last 3 vs first 3 purchases
    const sorted = [...results].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const oldAvg = sorted.slice(0, 3).reduce((s, i) => s + i.unit_price, 0) / Math.min(sorted.length, 3);
    const newAvg = sorted.slice(-3).reduce((s, i) => s + i.unit_price, 0) / Math.min(sorted.length, 3);
    const trend = newAvg > oldAvg ? "up" : newAvg < oldAvg ? "down" : "stable";

    return { totalQty, totalSpend, avgPrice, avgPricePerUnit, trend, count: results.length };
  }, [expenses, searchQuery]);

  const renderStatusIcon = (status: Expense["status"]) => {
    switch (status) {
      case "processing":
        return <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />;
      case "needs_review":
        return <div className="w-2 h-2 rounded-full bg-amber-500" />;
      case "failed":
        return <div className="w-2 h-2 rounded-full bg-red-500" />;
      default:
        return null;
    }
  };
  const handleConfirmReceipt = async () => {
    if (!householdId || !receiptData) return;
    setIsSaving(true);

    try {
      // 1. Update status to confirmed
      await updateDoc(doc(db, "households", householdId, "expenses", receiptData.id), {
        status: "confirmed",
        items: receiptData.items.map(item => ({ ...item, needs_category_confirm: false }))
      });

      // 2. Save categories to cache
      for (const item of receiptData.items) {
        await saveToCategoryCache(item.name, item.category, item.subcategory, receiptData.merchant_category);
      }

      setIsReviewSheetOpen(false);
      setReceiptData(null);
      showToast("Receipt confirmed and categories cached ✨");
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#B8955A', '#1A1A1A', '#EDE8DF']
      });
    } catch (err) {
      console.error("Confirmation failed:", err);
      showToast("Failed to confirm receipt");
    } finally {
      setIsSaving(false);
    }
  };

  const handleResolveDuplicate = async (action: "keep_new" | "keep_existing" | "keep_both") => {
    if (!householdId || !receiptData) return;
    
    try {
      if (action === "keep_existing") {
        await deleteDoc(doc(db, "households", householdId, "expenses", receiptData.id));
        setIsReviewSheetOpen(false);
        setReceiptData(null);
        showToast("Duplicate removed");
      } else if (action === "keep_new") {
        for (const dupId of receiptData.duplicateIds || []) {
          await deleteDoc(doc(db, "households", householdId, "expenses", dupId));
        }
        await handleConfirmReceipt();
      } else {
        await handleConfirmReceipt();
      }
    } catch (err) {
      console.error("Duplicate resolution failed:", err);
    }
  };

  const handleDeleteExpense = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!householdId) return;
    if (!confirm("Are you sure you want to delete this receipt?")) return;

    try {
      await deleteDoc(doc(db, "households", householdId, "expenses", id));
      showToast("Receipt deleted");
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // --- Render ---

  return (
    <div style={{ 
      minHeight: "100dvh", 
      background: "#F8F4EE", 
      paddingBottom: "120px",
      position: "relative"
    }}>
      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[10001] px-6 py-3 bg-gray-900 text-white text-sm font-medium rounded-full shadow-2xl flex items-center gap-3 whitespace-nowrap"
          >
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden Inputs */}
      <input 
        type="file" 
        accept="image/*" 
        capture="environment" 
        ref={cameraInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
      />
      <input 
        type="file" 
        accept="image/*" 
        ref={galleryInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
      />

      {/* Hero Section — Spend Progress */}
      <motion.div 
        initial={{ opacity: 0, y: 32, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ type: "spring", stiffness: 100, damping: 20 }}
        style={{ padding: "40px 24px 24px" }}
      >
        <div style={{ 
          background: "#EDE8DF", 
          border: "1px solid #D4CEC4", 
          borderRadius: "24px", 
          padding: "28px", 
          color: "#1A1A1A",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <p style={{ fontFamily: "'Outfit'", fontSize: "11px", textTransform: "uppercase", letterSpacing: "2px", color: "#B8955A", fontWeight: 600 }}>
              {format(new Date(), 'MMMM yyyy').toUpperCase()}
            </p>
            <div style={{ background: "#F8F4EE", border: "1px solid #D4CEC4", padding: "4px 12px", borderRadius: "999px", fontSize: "11px", fontFamily: "'Outfit'", fontWeight: 600, color: "#6B6560" }}>
              Month
            </div>
          </div>
          
          <div style={{ marginBottom: "8px", overflow: "hidden" }}>
            <span 
              ref={amountRef}
              style={{ fontFamily: "'Fraunces'", fontSize: "72px", fontWeight: 300, letterSpacing: "-3px", display: "inline-block" }}
            >
              ${totalMonthlySpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          
          <p style={{ fontFamily: "'Outfit'", fontSize: "16px", color: "#6B6560" }}>
            / $3,000 budget
          </p>

          <div style={{ height: "4px", background: "#D4CEC4", borderRadius: "999px", overflow: "hidden", margin: "20px 0 8px" }}>
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${spendPercentage}%` }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              style={{ height: "100%", background: "#B8955A" }}
            />
          </div>
          <p style={{ fontFamily: "'Outfit'", fontSize: "12px", color: "#6B6560" }}>
            {spendPercentage.toFixed(0)}% of monthly budget
          </p>
        </div>
      </motion.div>

      {/* Category breakdown */}
      <div style={{ marginBottom: "32px" }}>
        <div className="px-6 mb-4">
          <h2 style={{ fontFamily: "'Outfit'", fontSize: "11px", fontWeight: 600, color: "#B8955A", textTransform: "uppercase", letterSpacing: "2px" }}>By Category</h2>
        </div>
        <div style={{ 
          display: "flex", 
          overflowX: "auto", 
          gap: "12px", 
          padding: "0 24px",
          scrollSnapType: "x mandatory"
        }} className="no-scrollbar">
          {categoryBreakdown.map(cat => {
            const Icon = cat.icon;
            return (
              <motion.div 
                key={cat.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                style={{ 
                  background: "#EDE8DF", 
                  border: "1px solid #D4CEC4", 
                  borderRadius: "20px", 
                  padding: "20px", 
                  minWidth: "140px",
                  scrollSnapAlign: "start"
                }}
              >
                <div style={{ marginBottom: "12px" }}>
                  <Icon size={28} color="#B8955A" strokeWidth={1.5} />
                </div>
                <p style={{ fontFamily: "'Outfit'", fontSize: "12px", color: "#6B6560", textTransform: "uppercase", marginBottom: "8px", fontWeight: 600 }}>{cat.name}</p>
                <p style={{ fontFamily: "'Fraunces'", fontSize: "28px", fontWeight: 400, color: "#1A1A1A", margin: 0 }}>${cat.total.toLocaleString()}</p>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-6 mb-8">
        <div className="relative group">
          <div className="absolute left-4 top-1/2 -translate-y-1/2">
            <Search size={16} color="#D4CEC4" />
          </div>
          <input
            placeholder="Search items — milk, chicken..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="focus:border-[#B8955A] transition-colors"
            style={{
              width: "100%", height: "48px",
              background: "#EDE8DF", border: "1px solid #D4CEC4",
              borderRadius: "999px", padding: "0 16px 0 44px",
              fontFamily: "'Outfit'", fontSize: "14px", color: "#1A1A1A",
              outline: "none", caretColor: "#B8955A",
              fontStyle: "italic"
            }}
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-200 rounded-full transition-colors"
            >
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>

        {itemInsights && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 p-6 bg-[#EDE8DF] rounded-[32px] border border-[#D4CEC4] shadow-sm"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#F8F4EE] flex items-center justify-center text-[#B8955A]">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <h4 style={{ fontFamily: "'Fraunces'", fontSize: "18px", color: "#1A1A1A" }}>Item Insights</h4>
                  <p style={{ fontFamily: "'Outfit'", fontSize: "12px", color: "#6B6560" }}>Based on {itemInsights.count} purchases</p>
                </div>
              </div>
              <div className={`px-3 py-1 rounded-full flex items-center gap-1.5 ${
                itemInsights.trend === "up" ? "bg-red-50 text-red-600" : 
                itemInsights.trend === "down" ? "bg-green-50 text-green-600" : 
                "bg-gray-50 text-gray-500"
              }`}>
                <span className="text-xs font-bold uppercase tracking-wider font-outfit">
                  {itemInsights.trend === "up" ? "Rising" : itemInsights.trend === "down" ? "Falling" : "Stable"}
                </span>
                <span>{itemInsights.trend === "up" ? "📈" : itemInsights.trend === "down" ? "📉" : "↔️"}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-[#F8F4EE] rounded-2xl">
                <p style={{ fontFamily: "'Outfit'", fontSize: "10px", color: "#B8955A", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>Total Quantity</p>
                <p style={{ fontFamily: "'Fraunces'", fontSize: "20px", color: "#1A1A1A" }}>{itemInsights.totalQty} units</p>
              </div>
              <div className="p-4 bg-[#F8F4EE] rounded-2xl">
                <p style={{ fontFamily: "'Outfit'", fontSize: "10px", color: "#B8955A", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>Total Spend</p>
                <p style={{ fontFamily: "'Fraunces'", fontSize: "20px", color: "#1A1A1A" }}>${itemInsights.totalSpend.toFixed(2)}</p>
              </div>
              <div className="p-4 bg-[#F8F4EE] rounded-2xl col-span-2">
                <div className="flex justify-between items-center">
                  <div>
                    <p style={{ fontFamily: "'Outfit'", fontSize: "10px", color: "#B8955A", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>Average Price</p>
                    <p style={{ fontFamily: "'Fraunces'", fontSize: "20px", color: "#1A1A1A" }}>${itemInsights.avgPrice.toFixed(2)} <span className="text-xs font-outfit text-gray-400">/ unit</span></p>
                  </div>
                  <div className="text-right">
                    <p style={{ fontFamily: "'Outfit'", fontSize: "10px", color: "#B8955A", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>Per Purchase</p>
                    <p style={{ fontFamily: "'Fraunces'", fontSize: "20px", color: "#1A1A1A" }}>${itemInsights.avgPricePerUnit.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Recent Receipts */}
      <div className="px-6 space-y-4">
        <div className="flex items-center justify-between mb-2">
          <h2 style={{ fontFamily: "'Outfit'", fontSize: "11px", fontWeight: 600, color: "#B8955A", textTransform: "uppercase", letterSpacing: "2px" }}>
            {searchQuery ? "Search Results" : "Recent Receipts"}
          </h2>
          {searchQuery && (
            <span className="text-[10px] font-bold text-gray-400">{filteredExpenses.length} found</span>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="animate-spin text-[#B8955A]" size={32} />
            <p className="text-sm font-medium text-gray-400">Loading your finances...</p>
          </div>
        ) : filteredExpenses.length === 0 ? (
          <div className="text-center py-20 bg-[#EDE8DF] rounded-[32px] border border-dashed border-[#D4CEC4]">
            <div className="flex justify-center mb-4">
              <Receipt size={48} color="#D4CEC4" strokeWidth={1} />
            </div>
            <h3 style={{ fontFamily: "'Fraunces'", fontSize: "22px", color: "#1A1A1A", marginBottom: "4px" }}>No receipts yet</h3>
            <p style={{ fontFamily: "'Outfit'", fontSize: "14px", color: "#6B6560" }}>Tap + to scan your first receipt</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {filteredExpenses.map((exp, index) => {
              const Icon = categoryIcons[exp.merchant_category] || MoreHorizontal;
              return (
                <motion.div
                  layout
                  key={exp.id}
                  initial={{ opacity: 0, y: 32, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: index * 0.06, type: "spring", stiffness: 100, damping: 20 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    if (exp.status === "processing") return;
                    if (exp.status === "needs_review") {
                      setReceiptData(exp);
                      setIsReviewSheetOpen(true);
                    } else {
                      setExpandedReceiptId(expandedReceiptId === exp.id ? null : exp.id);
                    }
                  }}
                  className="w-full"
                >
                  {exp.status === "processing" ? (
                    <div style={{ background: "#EDE8DF", border: "1px solid #D4CEC4", borderRadius: "20px", padding: "20px", opacity: 0.7, marginBottom: "12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <motion.div
                          animate={{ opacity: [0.4, 1, 0.4] }}
                          transition={{ duration: 1.5, repeat: Infinity }}
                          style={{ width: "52px", height: "52px", borderRadius: "14px", background: "#F8F4EE" }}
                        />
                        <div>
                          <p style={{ fontFamily: "'Fraunces'", fontSize: "20px", color: "#6B6560", margin: 0 }}>Scanning receipt...</p>
                          <p style={{ fontFamily: "'Outfit'", fontSize: "12px", color: "#D4CEC4", margin: 0 }}>Processing in background</p>
                        </div>
                      </div>
                    </div>
                  ) : exp.status === "failed" ? (
                    <div 
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      style={{ background: "#F5E6E0", border: "1px solid #C97B6A", borderRadius: "20px", padding: "20px", marginBottom: "12px" }}
                    >
                      <p style={{ fontFamily: "'Outfit'", fontSize: "14px", color: "#C97B6A", margin: 0 }}>Scan failed — tap to retry</p>
                    </div>
                  ) : (
                    <div style={{ position: "relative", marginBottom: "12px" }}>
                      {/* Status dots */}
                      {exp.status === "needs_review" && (
                        <div style={{
                          position: "absolute", top: "20px", right: "20px",
                          width: "8px", height: "8px",
                          borderRadius: "50%", background: exp.duplicateIds && exp.duplicateIds.length > 0 ? "#C97B6A" : "#B8955A",
                          zIndex: 10
                        }} />
                      )}
                      
                      <div style={{ 
                        background: "#EDE8DF", 
                        border: "1px solid #D4CEC4", 
                        borderRadius: "20px", 
                        padding: "20px",
                        cursor: "pointer"
                      }}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div style={{ width: "52px", height: "52px", background: "#F8F4EE", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <Icon size={24} color="#B8955A" strokeWidth={1.5} />
                            </div>
                            <div>
                              <h3 style={{ fontFamily: "'Fraunces'", fontSize: "20px", fontWeight: 400, color: "#1A1A1A", margin: "0 0 2px" }}>{exp.merchant_name}</h3>
                              <div className="flex items-center gap-2">
                                <span style={{ fontFamily: "'Outfit'", fontSize: "12px", color: "#6B6560" }}>{exp.date}</span>
                                <span style={{ fontFamily: "'Outfit'", fontSize: "12px", color: "#B8955A", fontWeight: 600 }}>{exp.items.length} items</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <p style={{ fontFamily: "'Fraunces'", fontSize: "22px", color: "#1A1A1A", margin: 0 }}>${exp.total.toFixed(2)}</p>
                          </div>
                        </div>

                        <AnimatePresence>
                          {expandedReceiptId === exp.id && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="pt-6 mt-6 border-t border-[#D4CEC4] space-y-3">
                                {exp.items.map((item, idx) => (
                                  <div key={idx} className="flex justify-between items-start gap-4">
                                    <div className="flex-1">
                                      <p style={{ fontFamily: "'Outfit'", fontSize: "14px", fontWeight: 600, color: "#1A1A1A", margin: 0 }}>{item.name}</p>
                                      <p style={{ fontFamily: "'Outfit'", fontSize: "10px", fontWeight: 700, color: "#6B6560", textTransform: "uppercase", letterSpacing: "1px" }}>
                                        {item.quantity > 1 && `${item.quantity}x `}{item.category} • {item.subcategory}
                                      </p>
                                    </div>
                                    <span style={{ fontFamily: "'Fraunces'", fontSize: "14px", color: "#1A1A1A" }}>${item.total_price.toFixed(2)}</span>
                                  </div>
                                ))}
                                
                                <div className="pt-4 flex items-center justify-between">
                                  <button 
                                    onClick={(e) => handleDeleteExpense(exp.id, e)}
                                    style={{ fontFamily: "'Outfit'", fontSize: "10px", fontWeight: 700, color: "#C97B6A", textTransform: "uppercase", letterSpacing: "1px", background: "none", border: "none", cursor: "pointer" }}
                                  >
                                    Delete Entry
                                  </button>
                                  {exp.receiptURL && (
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(exp.receiptURL, '_blank');
                                      }}
                                      style={{ 
                                        padding: "8px 16px", 
                                        background: "#1A1A1A", 
                                        color: "#FFFFFF", 
                                        borderRadius: "12px", 
                                        fontFamily: "'Outfit'", 
                                        fontSize: "10px", 
                                        fontWeight: 700, 
                                        textTransform: "uppercase", 
                                        letterSpacing: "1px",
                                        border: "none",
                                        cursor: "pointer"
                                      }}
                                    >
                                      View Receipt
                                    </button>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* FAB */}
      <motion.button
        whileTap={{ scale: 0.92, rotate: 45 }}
        onClick={() => setIsActionSheetOpen(true)}
        style={{
          position: "fixed",
          bottom: "calc(96px + env(safe-area-inset-bottom))",
          right: "24px",
          width: "60px",
          height: "60px",
          background: "#1A1A1A",
          color: "#FFFFFF",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 32px rgba(26,26,26,0.2)",
          zIndex: 100,
          border: "none",
          cursor: "pointer"
        }}
      >
        <Plus size={24} />
      </motion.button>

      {/* Action Sheet */}
      <AnimatePresence>
        {isActionSheetOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsActionSheetOpen(false)}
              className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9998]"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed bottom-0 left-0 right-0 z-[9999] bg-[#F8F4EE] rounded-t-[32px] p-6 pb-12 shadow-2xl"
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-8" />
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={handleTakePhoto}
                  className="flex flex-col items-center justify-center gap-4 p-8 bg-white rounded-3xl border border-gray-100 shadow-sm active:scale-95 transition-transform"
                >
                  <div className="w-16 h-16 rounded-2xl bg-[#F8F4EE] flex items-center justify-center text-3xl">📸</div>
                  <span className="font-bold text-gray-900">Take Photo</span>
                </button>
                <button
                  onClick={handleChooseFromLibrary}
                  className="flex flex-col items-center justify-center gap-4 p-8 bg-white rounded-3xl border border-gray-100 shadow-sm active:scale-95 transition-transform"
                >
                  <div className="w-16 h-16 rounded-2xl bg-[#F8F4EE] flex items-center justify-center text-3xl">🖼️</div>
                  <span className="font-bold text-gray-900">Library</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Processing Overlay */}
      <AnimatePresence>
        {isProcessing && createPortal(
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed", inset: 0,
              background: "#F8F4EE",
              zIndex: 10000,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              padding: "40px"
            }}
          >
            <div className="w-24 h-24 mb-8 relative">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                className="absolute inset-0 border-4 border-[#B8955A] border-t-transparent rounded-full"
              />
              <div className="absolute inset-0 flex items-center justify-center text-3xl">✨</div>
            </div>
            <h2 style={{ fontFamily: "'Fraunces'", fontSize: "24px", color: "#1A1A1A", marginBottom: "12px" }}>Reading Receipt...</h2>
            <p style={{ fontFamily: "'Outfit'", fontSize: "14px", color: "#6B6560", textAlign: "center" }}>Gemini is extracting items and totals for you.</p>
          </motion.div>,
          document.body
        )}
      </AnimatePresence>

      {/* Review Sheet */}
      <AnimatePresence>
        {isReviewSheetOpen && receiptData && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsReviewSheetOpen(false)}
              className="fixed inset-0 bg-gray-900/60 backdrop-blur-md z-[9998]"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="fixed bottom-0 left-0 right-0 z-[9999] bg-[#F8F4EE] rounded-t-[40px] max-h-[94dvh] flex flex-col shadow-2xl"
            >
              <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mt-4 mb-2 flex-shrink-0" />
              
              <div className="flex-1 overflow-y-auto px-6 pt-4 pb-32 no-scrollbar">
                {/* Header */}
                <div className="text-center mb-8">
                  {receiptData.receiptURL && (
                    <div className="w-20 h-20 mx-auto mb-4 rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
                      <img src={receiptData.receiptURL} alt="Receipt" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                  )}
                  <h2 style={{ fontFamily: "'Fraunces'", fontSize: "28px", color: "#1A1A1A", marginBottom: "4px" }}>
                    {receiptData.merchant_name}
                  </h2>
                  <p style={{ fontFamily: "'Outfit'", fontSize: "13px", color: "#B8955A", fontWeight: 600 }}>
                    {receiptData.date} • {receiptData.time} {receiptData.receipt_number && `• #${receiptData.receipt_number}`}
                  </p>
                  <div className="mt-6">
                    <p style={{ fontFamily: "'Fraunces'", fontSize: "52px", color: "#1A1A1A", margin: 0 }}>
                      ${receiptData.total.toFixed(2)}
                    </p>
                    <p style={{ fontFamily: "'Outfit'", fontSize: "13px", color: "#6B6560", opacity: 0.6 }}>
                      Includes ${receiptData.tax_gst.toFixed(2)} GST
                    </p>
                  </div>
                </div>

                {/* Line Items */}
                <div className="space-y-0 mb-8">
                  <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Line Items</h3>
                  {receiptData.items.map((item, idx) => (
                    <div key={idx} style={{ padding: "12px 0", borderBottom: "1px solid #D4CEC4" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                        <p style={{ fontFamily: "'Outfit'", fontSize: "15px", color: "#1A1A1A", margin: 0 }}>{item.name}</p>
                        <p style={{ fontFamily: "'Fraunces'", fontSize: "16px", color: "#1A1A1A", margin: 0 }}>${item.total_price.toFixed(2)}</p>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <p style={{ fontFamily: "'Outfit'", fontSize: "12px", color: "#6B6560", margin: 0 }}>Qty: {item.quantity}</p>
                        
                        {/* Category Selector */}
                        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                          <motion.button
                            type="button"
                            whileTap={{ scale: 0.96 }}
                            style={{
                              background: item.from_cache ? "#EDE8DF" : "#F0E4CC",
                              border: `1px solid ${item.from_cache ? "#D4CEC4" : "#B8955A"}`,
                              borderRadius: "999px",
                              padding: "4px 10px",
                              fontFamily: "'Outfit'",
                              fontSize: "11px",
                              color: "#1A1A1A",
                              cursor: "pointer",
                              whiteSpace: "nowrap"
                            }}
                          >
                            {item.subcategory} {item.from_cache ? "" : "· confirm?"}
                          </motion.button>
                          
                          {/* Quick change options if not confirmed */}
                          {!item.from_cache && (
                            <div className="flex gap-1">
                              {["groceries", "dining", "shopping", "other"].filter(c => c !== item.category).map(cat => (
                                <button
                                  key={cat}
                                  onClick={() => {
                                    const newItems = [...receiptData.items];
                                    newItems[idx] = { ...item, category: cat, subcategory: cat, from_cache: true };
                                    setReceiptData({ ...receiptData, items: newItems });
                                  }}
                                  className="px-2 py-1 rounded-full bg-gray-100 text-[9px] font-bold text-gray-500 uppercase"
                                >
                                  {cat}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Duplicate Warning Section */}
                {receiptData.duplicateIds && receiptData.duplicateIds.length > 0 && (
                  <div style={{ background: "#F5E6E0", border: "1px solid #C97B6A", borderRadius: "16px", padding: "16px", margin: "16px 0" }}>
                    <p style={{ fontFamily: "'Fraunces'", fontSize: "16px", color: "#C97B6A", margin: "0 0 8px" }}>
                      Possible duplicate found
                    </p>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <div style={{ flex: 1, background: "#F8F4EE", borderRadius: "12px", padding: "12px" }}>
                        <p style={{ fontFamily: "'Outfit'", fontSize: "11px", color: "#B8955A", margin: "0 0 4px" }}>THIS RECEIPT</p>
                        <p style={{ fontFamily: "'Fraunces'", fontSize: "18px", color: "#1A1A1A", margin: "0 0 2px" }}>${receiptData.total.toFixed(2)}</p>
                        <p style={{ fontFamily: "'Outfit'", fontSize: "12px", color: "#6B6560", margin: 0 }}>{receiptData.date}</p>
                      </div>
                      <div style={{ flex: 1, background: "#F8F4EE", borderRadius: "12px", padding: "12px" }}>
                        <p style={{ fontFamily: "'Outfit'", fontSize: "11px", color: "#C97B6A", margin: "0 0 4px" }}>EXISTING</p>
                        {/* We'd need to fetch the actual duplicate data here for a true comparison, 
                            but for now we show the total from the first duplicate ID found */}
                        <p style={{ fontFamily: "'Fraunces'", fontSize: "18px", color: "#1A1A1A", margin: "0 0 2px" }}>${receiptData.total.toFixed(2)}</p>
                        <p style={{ fontFamily: "'Outfit'", fontSize: "12px", color: "#6B6560", margin: 0 }}>{receiptData.date}</p>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
                      <button 
                        type="button" 
                        onClick={() => handleResolveDuplicate("keep_new")} 
                        style={{ background: "#1A1A1A", color: "#FFFFFF", border: "none", borderRadius: "999px", height: "40px", fontFamily: "'Outfit'", fontSize: "13px", cursor: "pointer" }}
                      >
                        Keep this one, delete existing
                      </button>
                      <button 
                        type="button" 
                        onClick={() => handleResolveDuplicate("keep_existing")} 
                        style={{ background: "#EDE8DF", color: "#1A1A1A", border: "1px solid #D4CEC4", borderRadius: "999px", height: "40px", fontFamily: "'Outfit'", fontSize: "13px", cursor: "pointer" }}
                      >
                        Keep existing, discard this
                      </button>
                      <button 
                        type="button" 
                        onClick={() => handleResolveDuplicate("keep_both")} 
                        style={{ background: "transparent", color: "#6B6560", border: "none", borderRadius: "999px", height: "40px", fontFamily: "'Outfit'", fontSize: "13px", cursor: "pointer" }}
                      >
                        Keep both
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer Actions */}
              <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#F8F4EE] via-[#F8F4EE] to-transparent pt-12">
                <button
                  onClick={handleConfirmReceipt}
                  disabled={isSaving}
                  className="w-full py-5 bg-[#1A1A1A] text-white rounded-2xl font-bold text-lg shadow-xl shadow-gray-900/20 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <span>Confirm Receipt ✦</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
