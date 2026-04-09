import { 
  collection, 
  doc, 
  setDoc, 
  serverTimestamp, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  limit,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebase';
import { GoogleGenAI, Type } from "@google/genai";

export const MOOD_EMOJIS = ["😔", "😐", "🙂", "😊", "🤩"];

export interface MoodEntry {
  userId: string;
  mood: number;
  date: string;
  createdAt: any;
}

export const saveMood = async (householdId: string, userId: string, mood: number) => {
  const date = new Date().toISOString().split('T')[0];
  const moodId = `${date}-${userId}`;
  const moodRef = doc(db, 'households', householdId, 'moods', moodId);
  
  await setDoc(moodRef, {
    userId,
    mood,
    date,
    createdAt: serverTimestamp()
  });
};

export const getMoodInsights = async (
  householdId: string, 
  userId: string, 
  partnerId: string,
  context: { dateNights: number; chores: number; spending: number }
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  // Fetch last 30 days of moods
  const moodsRef = collection(db, 'households', householdId, 'moods');
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const q = query(
    moodsRef, 
    where('createdAt', '>=', Timestamp.fromDate(thirtyDaysAgo)),
    orderBy('createdAt', 'asc')
  );
  
  const snap = await getDocs(q);
  const allMoods = snap.docs.map(d => d.data() as MoodEntry);
  
  const myMoods = allMoods.filter(m => m.userId === userId).map(m => ({ date: m.date, score: m.mood }));
  const partnerMoods = allMoods.filter(m => m.userId === partnerId).map(m => ({ date: m.date, score: m.mood }));

  const prompt = `Here are mood scores for a couple over the last 30 days (1-5 scale).
  My scores: ${JSON.stringify(myMoods)}
  Partner scores: ${JSON.stringify(partnerMoods)}
  
  Also here is relevant context:
  - Date nights: ${context.dateNights}
  - Chores completed: ${context.chores}
  - Money spent: $${context.spending}

  Find 1-2 genuine patterns. Be warm and specific. Return ONLY JSON array:
  [{ "emoji": "string", "insight": "string (max 2 sentences)" }]`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              emoji: { type: Type.STRING },
              insight: { type: Type.STRING }
            },
            required: ["emoji", "insight"]
          }
        }
      }
    });
    
    return JSON.parse(response.text || "[]");
  } catch (err) {
    console.error("Mood insights failed:", err);
    return [];
  }
};
