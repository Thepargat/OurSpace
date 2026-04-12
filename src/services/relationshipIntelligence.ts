import { 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  doc, 
  setDoc, 
  getDoc, 
  serverTimestamp,
  Timestamp
} from "firebase/firestore";
import { db } from "../firebase";
import { GoogleGenerativeAI } from "@google/generative-ai";

// --- Types ---
export interface RelationshipMetrics {
  myGroceries: number;
  partnerGroceries: number;
  myChores: number;
  partnerChores: number;
  daysSinceDate: number | null;
  daysSinceMemory: number | null;
  totalSpend: number;
  dateNightCount: number;
  myMoods: { date: string; score: number }[];
  partnerMoods: { date: string; score: number }[];
}

export interface Insight {
  type: 'date_night' | 'chores' | 'groceries' | 'memories' | 'spending' | 'positive' | 'mood';
  emoji: string;
  title: string;
  body: string;
  action: string | null;
}

export interface CachedInsights {
  insights: Insight[];
  generatedAt: Timestamp;
  metrics: RelationshipMetrics;
}

// --- Service Logic ---

const ensureDate = (val: any): Date | null => {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val.toDate === 'function') return val.toDate();
  if (typeof val === 'object' && val.seconds !== undefined) return new Date(val.seconds * 1000);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

export const analyzeRelationship = async (householdId: string, userId: string, partnerId: string) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // 1. Groceries
  const groceriesSnap = await getDocs(query(
    collection(db, "households", householdId, "groceries"),
    where("createdAt", ">=", Timestamp.fromDate(thirtyDaysAgo))
  ));
  const groceries = groceriesSnap.docs.map(d => d.data());

  // 2. Chores
  const choresSnap = await getDocs(query(
    collection(db, "households", householdId, "chores"),
    where("lastCompletedAt", ">=", Timestamp.fromDate(thirtyDaysAgo))
  ));
  const chores = choresSnap.docs.map(d => d.data());

  // 3. Date Nights (Events with category "datenight")
  const eventsSnap = await getDocs(query(
    collection(db, "households", householdId, "events"),
    where("category", "==", "datenight"),
    where("date", ">=", Timestamp.fromDate(thirtyDaysAgo)),
    orderBy("date", "desc")
  ));
  const events = eventsSnap.docs.map(d => d.data());

  // 4. Memories
  const memoriesSnap = await getDocs(query(
    collection(db, "households", householdId, "memories"),
    where("date", ">=", Timestamp.fromDate(thirtyDaysAgo)),
    orderBy("date", "desc")
  ));
  const memories = memoriesSnap.docs.map(d => d.data());

  // 5. Expenses
  const expensesSnap = await getDocs(query(
    collection(db, "households", householdId, "expenses"),
    where("date", ">=", Timestamp.fromDate(startOfMonth))
  ));
  const expenses = expensesSnap.docs.map(d => d.data());

  // 6. Moods
  const moodsSnap = await getDocs(query(
    collection(db, "households", householdId, "moods"),
    where("createdAt", ">=", Timestamp.fromDate(thirtyDaysAgo)),
    orderBy("createdAt", "asc")
  ));
  const moods = moodsSnap.docs.map(d => d.data());

  return { groceries, chores, events, memories, expenses, moods };
};

export const calculateMetrics = (data: any, userId: string, partnerId: string): RelationshipMetrics => {
  const myGroceries = data.groceries.filter((g: any) => g.addedBy === userId).length;
  const partnerGroceries = data.groceries.filter((g: any) => g.addedBy === partnerId).length;

  const myChores = data.chores.filter((c: any) => c.lastCompletedBy === userId || c.completedBy === userId).length;
  const partnerChores = data.chores.filter((c: any) => c.lastCompletedBy === partnerId || c.completedBy === partnerId).length;

  const lastDateNight = ensureDate(data.events[0]?.date);
  const daysSinceDate = lastDateNight
    ? Math.floor((new Date().getTime() - lastDateNight.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const lastMemory = ensureDate(data.memories[0]?.date);
  const daysSinceMemory = lastMemory
    ? Math.floor((new Date().getTime() - lastMemory.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const totalSpend = data.expenses.reduce((sum: number, e: any) => sum + (e.total || e.amount || 0), 0);
  const dateNightCount = data.events.length;

  // Mood metrics
  const myMoods = data.moods.filter((m: any) => m.userId === userId).map((m: any) => ({ date: m.date, score: m.mood }));
  const partnerMoods = data.moods.filter((m: any) => m.userId === partnerId).map((m: any) => ({ date: m.date, score: m.mood }));

  return {
    myGroceries, partnerGroceries,
    myChores, partnerChores,
    daysSinceDate, daysSinceMemory,
    totalSpend, dateNightCount,
    myMoods, partnerMoods
  };
};

export const generateInsights = async (metrics: RelationshipMetrics, userName: string, partnerName: string): Promise<Insight[]> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) return [];
  
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
  
  const prompt = `You are a warm caring relationship coach. Analyse these real metrics from a couple's shared app and generate 3-4 short warm actionable insights. 
  
  CRITICAL: At least one insight MUST be a "mood" pattern analysis using this exact logic:
  "Here are mood scores for a couple over the last 30 days.
  ${userName} scores: ${JSON.stringify(metrics.myMoods)}
  ${partnerName} scores: ${JSON.stringify(metrics.partnerMoods)}
  Also here is relevant context:
  - Date nights: ${metrics.dateNightCount}
  - Chores completed: ${metrics.myChores + metrics.partnerChores}
  - Money spent: $${metrics.totalSpend.toFixed(2)}
  Find 1-2 genuine patterns. Be warm and specific."
  
  Be specific to their numbers. Never generic. Never preachy. Always warm and encouraging. Return ONLY a JSON array. No markdown. No explanation.
  
  Format:
  [{
    "type": "date_night|chores|groceries|memories|spending|positive|mood",
    "emoji": "single emoji",
    "title": "short bold headline max 6 words",
    "body": "one warm sentence with specific numbers from their data (max 2 sentences for mood insights)",
    "action": "one short actionable suggestion or null"
  }]`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
    return JSON.parse(text || "[]");
  } catch (e) {
    console.error("Failed to parse Gemini response:", e);
    return [];
  }
};

export const getOrUpdateInsights = async (householdId: string, userId: string, partnerId: string, userName: string, partnerName: string, forceRefresh = false) => {
  const insightsRef = doc(db, "households", householdId, "insights", "latest");
  const snapshot = await getDoc(insightsRef);
  
  if (!forceRefresh && snapshot.exists()) {
    const data = snapshot.data() as CachedInsights;
    const lastGenerated = data.generatedAt.toDate();
    const now = new Date();
    const diffHours = (now.getTime() - lastGenerated.getTime()) / (1000 * 60 * 60);
    
    if (diffHours < 24) {
      return data.insights;
    }
  }

  // Regenerate
  const rawData = await analyzeRelationship(householdId, userId, partnerId);
  const metrics = calculateMetrics(rawData, userId, partnerId);
  
  // Check if there's enough data (optional, but specified in empty state)
  const hasData = metrics.myGroceries > 0 || metrics.partnerGroceries > 0 || metrics.myChores > 0 || metrics.partnerChores > 0 || metrics.dateNightCount > 0;
  
  if (!hasData) {
    return null; // Signals empty state
  }

  const insights = await generateInsights(metrics, userName, partnerName);
  
  await setDoc(insightsRef, {
    insights,
    generatedAt: serverTimestamp(),
    metrics
  });

  return insights;
};
