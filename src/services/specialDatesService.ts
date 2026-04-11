import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc,
  addDoc,
  orderBy,
  limit,
  Timestamp 
} from "firebase/firestore";
import { db } from "../firebase";
import { differenceInDays, addYears, isBefore, startOfDay, format, getYear } from "date-fns";

export interface SpecialDate {
  id: string;
  name: string;
  date: Date;
  type: 'anniversary' | 'birthday' | 'event';
  emoji: string;
  daysUntil: number;
  originalDate?: Date;
}

export const getSpecialDates = async (householdId: string, userId: string, partnerId: string | null) => {
  const dates: SpecialDate[] = [];
  const now = startOfDay(new Date());

  // 1. Get User Birthdays and Anniversary
  const userDoc = await getDoc(doc(db, "users", userId));
  const userData = userDoc.data();

  if (userData?.birthday) {
    const bday = userData.birthday.toDate();
    dates.push(calculateYearlyDate(bday, "Your Birthday", "birthday", "🎂"));
  }
  if (userData?.anniversaryDate) {
    const anniv = userData.anniversaryDate.toDate();
    dates.push(calculateYearlyDate(anniv, "Anniversary", "anniversary", "💍"));
  }

  // 2. Get Partner Birthday
  if (partnerId) {
    const partnerDoc = await getDoc(doc(db, "users", partnerId));
    const partnerData = partnerDoc.data();
    if (partnerData?.birthday) {
      const bday = partnerData.birthday.toDate();
      dates.push(calculateYearlyDate(bday, `${partnerData.displayName || 'Partner'}'s Birthday`, "birthday", "🎁"));
    }
  }

  // 3. Get Special Events
  const eventsSnap = await getDocs(query(
    collection(db, "households", householdId, "events"),
    where("category", "==", "special")
  ));

  eventsSnap.forEach(d => {
    const data = d.data();
    if (!data.date || typeof data.date.toDate !== 'function') return;
    const eventDate = data.date.toDate();
    const days = differenceInDays(startOfDay(eventDate), now);
    if (days >= 0 && days <= 60) {
      dates.push({
        id: d.id,
        name: data.title,
        date: eventDate,
        type: 'event',
        emoji: "✨",
        daysUntil: days
      });
    }
  });

  return dates.filter(d => d.daysUntil >= 0 && d.daysUntil <= 60).sort((a, b) => a.daysUntil - b.daysUntil);
};

const calculateYearlyDate = (originalDate: Date, name: string, type: 'anniversary' | 'birthday', emoji: string): SpecialDate => {
  const now = startOfDay(new Date());
  let nextDate = new Date(originalDate);
  nextDate.setFullYear(now.getFullYear());

  if (isBefore(nextDate, now)) {
    nextDate = addYears(nextDate, 1);
  }

  return {
    id: `${type}-${originalDate.getTime()}`,
    name,
    date: nextDate,
    type,
    emoji,
    daysUntil: differenceInDays(nextDate, now),
    originalDate
  };
};

export const checkReminders = async (householdId: string, dates: SpecialDate[]) => {
  const remindersRef = doc(db, "households", householdId, "remindersSent", "status");
  const snap = await getDoc(remindersRef);
  const sent = snap.exists() ? snap.data() : {};
  const newSent = { ...sent };
  let hasChanges = false;

  for (const date of dates) {
    const key = `${date.id}-${date.date.getFullYear()}`;
    const days = date.daysUntil;
    const milestones = [60, 30, 14, 7, 1, 0];
    
    for (const m of milestones) {
      if (days === m && !sent[`${key}-${m}`]) {
        // Create Proactive Alert
        let message = "";
        if (m === 60) message = `${date.name} is in 2 months — start thinking about plans`;
        else if (m === 30) message = `One month until ${date.name} 💝`;
        else if (m === 14) message = `2 weeks until ${date.name} — have you booked anything?`;
        else if (m === 7) message = `${date.name} is next week! 💍`;
        else if (m === 1) message = `${date.name} is tomorrow! Final prep time.`;
        else if (m === 0) message = `Happy ${date.name}! 🎉`;

        if (message) {
          await addDoc(collection(db, "households", householdId, "proactiveAlerts"), {
            type: date.type === 'anniversary' ? 'anniversary' : (date.type === 'birthday' ? 'birthday' : 'chore'),
            message,
            detectedAt: Timestamp.now(),
            read: false,
            priority: m <= 7 ? "high" : "medium",
            relatedId: date.id
          });
        }

        newSent[`${key}-${m}`] = true;
        hasChanges = true;
      }
    }
  }

  if (hasChanges) {
    await setDoc(remindersRef, newSent, { merge: true });
  }
};

export const getEarliestMemory = async (householdId: string) => {
  const memoriesSnap = await getDocs(query(
    collection(db, "households", householdId, "memories"),
    orderBy("date", "asc"),
    limit(1)
  ));
  return memoriesSnap.docs[0]?.data();
};
