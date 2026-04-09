import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  getDoc, 
  setDoc, 
  Timestamp
} from "firebase/firestore";
import { db } from "../firebase";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { subDays, startOfDay, endOfDay, format } from "date-fns";

export interface WeeklySummary {
  narrative: string;
  stats: {
    spent: number;
    receipts: number;
    biggestPurchase: string;
    groceriesAdded: number;
    groceriesCompleted: number;
    choresCompleted: Record<string, number>;
    eventsCount: number;
    memoriesCount: number;
    moods: Record<string, number>;
    bucketCompleted: number;
  };
  weekStart: Timestamp;
  weekEnd: Timestamp;
  generatedAt: Timestamp;
  dismissedAt?: Timestamp | null;
}

export const generateWeeklySummary = async (
  householdId: string, 
  userId: string, 
  userName: string, 
  partnerId: string, 
  partnerName: string
) => {
  const now = new Date();
  const isSun = now.getDay() === 0; // 0 is Sunday
  
  const weekEnd = endOfDay(now);
  const weekStart = startOfDay(subDays(now, 7));

  // 1. Check if already generated this week
  const latestDocRef = doc(db, "households", householdId, "weeklySummary", "latest");
  const latestDoc = await getDoc(latestDocRef);
  
  if (latestDoc.exists()) {
    const data = latestDoc.data() as WeeklySummary;
    if (data.generatedAt) {
      const generatedAt = data.generatedAt.toDate();
      const diffDays = (now.getTime() - generatedAt.getTime()) / (1000 * 60 * 60 * 24);
      
      // If it's not Sunday, and we have a recent summary, return it (for visibility check)
      // If it IS Sunday, and we generated it less than 24h ago, return it
      if (!isSun || diffDays < 1) return data;
    }
  }

  // If it's not Sunday, don't generate a new one
  if (!isSun) return null;

  // 2. Collect Data
  const stats = {
    spent: 0,
    receipts: 0,
    biggestPurchase: "None",
    groceriesAdded: 0,
    groceriesCompleted: 0,
    choresCompleted: { [userId]: 0, [partnerId]: 0 } as Record<string, number>,
    eventsCount: 0,
    memoriesCount: 0,
    moods: { [userId]: 0, [partnerId]: 0 } as Record<string, number>,
    bucketCompleted: 0
  };

  // Expenses
  const expensesSnap = await getDocs(query(
    collection(db, "households", householdId, "expenses"),
    where("createdAt", ">=", weekStart),
    where("createdAt", "<=", weekEnd)
  ));
  let maxExpense = 0;
  expensesSnap.forEach(d => {
    const data = d.data();
    stats.spent += data.total || 0;
    stats.receipts++;
    if (data.total > maxExpense) {
      maxExpense = data.total;
      stats.biggestPurchase = `${data.merchant_name} ($${data.total})`;
    }
  });

  // Groceries
  const groceriesSnap = await getDocs(query(
    collection(db, "households", householdId, "groceries"),
    where("createdAt", ">=", weekStart),
    where("createdAt", "<=", weekEnd)
  ));
  stats.groceriesAdded = groceriesSnap.size;
  
  const groceriesCompSnap = await getDocs(query(
    collection(db, "households", householdId, "groceries"),
    where("completed", "==", true),
    where("completedAt", ">=", weekStart),
    where("completedAt", "<=", weekEnd)
  ));
  stats.groceriesCompleted = groceriesCompSnap.size;

  // Chores
  const choresSnap = await getDocs(query(
    collection(db, "households", householdId, "chores"),
    where("lastCompletedAt", ">=", weekStart),
    where("lastCompletedAt", "<=", weekEnd)
  ));
  choresSnap.forEach(d => {
    const data = d.data();
    const by = data.lastCompletedBy;
    if (by === userId || by === partnerId) {
      stats.choresCompleted[by] = (stats.choresCompleted[by] || 0) + 1;
    }
  });

  // Events
  const eventsSnap = await getDocs(query(
    collection(db, "households", householdId, "events"),
    where("date", ">=", weekStart),
    where("date", "<=", weekEnd)
  ));
  stats.eventsCount = eventsSnap.size;
  const eventNames = eventsSnap.docs.map(d => d.data().title).join(", ");

  // Memories
  const memoriesSnap = await getDocs(query(
    collection(db, "households", householdId, "memories"),
    where("date", ">=", weekStart),
    where("date", "<=", weekEnd)
  ));
  stats.memoriesCount = memoriesSnap.size;

  // Moods
  const moodsSnap = await getDocs(query(
    collection(db, "households", householdId, "moods"),
    where("createdAt", ">=", weekStart),
    where("createdAt", "<=", weekEnd)
  ));
  const moodTotals: Record<string, { sum: number, count: number }> = {};
  moodsSnap.forEach(d => {
    const data = d.data();
    if (data.userId === userId || data.userId === partnerId) {
      if (!moodTotals[data.userId]) moodTotals[data.userId] = { sum: 0, count: 0 };
      moodTotals[data.userId].sum += data.mood;
      moodTotals[data.userId].count++;
    }
  });
  Object.keys(moodTotals).forEach(uid => {
    stats.moods[uid] = moodTotals[uid].sum / moodTotals[uid].count;
  });

  // Bucket List
  const bucketSnap = await getDocs(query(
    collection(db, "households", householdId, "bucketList"),
    where("completed", "==", true),
    where("completedAt", ">=", weekStart),
    where("completedAt", "<=", weekEnd)
  ));
  stats.bucketCompleted = bucketSnap.size;
  const bucketItems = bucketSnap.docs.map(d => d.data().title).join(", ");

  // 3. Gemini Call
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview" });

  const prompt = `Write a warm weekly summary for a couple based on their real data.
Week of ${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d")}.
Data:
- Spent: $${stats.spent.toFixed(2)} across ${stats.receipts} receipts
- Biggest purchase: ${stats.biggestPurchase}
- Groceries: ${stats.groceriesAdded} items added, ${stats.groceriesCompleted} completed
- Chores: ${userName} did ${stats.choresCompleted[userId] || 0}, ${partnerName} did ${stats.choresCompleted[partnerId] || 0}
- Events: ${eventNames || "None"}
- New memories: ${stats.memoriesCount} added
- Mood: ${userName} averaged ${stats.moods[userId] ? stats.moods[userId].toFixed(1) : "N/A"}/5, ${partnerName} averaged ${stats.moods[partnerId] ? stats.moods[partnerId].toFixed(1) : "N/A"}/5
- Bucket list: ${bucketItems || "None"}

Write a 2-3 sentence warm narrative summary of their week. Specific. Warm. Personal. Not generic. End with one positive observation about them as a couple.
Return plain text only. No JSON. No formatting.`;

  try {
    const result = await model.generateContent(prompt);
    const narrative = result.response.text();

    const summaryData: WeeklySummary = {
      narrative,
      stats,
      weekStart: Timestamp.fromDate(weekStart),
      weekEnd: Timestamp.fromDate(weekEnd),
      generatedAt: Timestamp.fromDate(now),
      dismissedAt: null
    };

    await setDoc(latestDocRef, summaryData);
    return summaryData;
  } catch (error) {
    console.error("Error generating weekly summary:", error);
    return null;
  }
};

export const dismissWeeklySummary = async (householdId: string) => {
  const latestDocRef = doc(db, "households", householdId, "weeklySummary", "latest");
  await setDoc(latestDocRef, { dismissedAt: Timestamp.now() }, { merge: true });
};
