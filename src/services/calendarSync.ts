import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, Timestamp } from "firebase/firestore";
import { db } from "../firebase";
import { startOfMonth, endOfMonth, addDays } from "date-fns";

const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export interface CalendarEvent {
  id?: string;
  googleEventId?: string;
  title: string;
  startTime: string; // ISO string
  endTime: string; // ISO string
  notes?: string;
  category: 'Work' | 'Personal' | 'Date Night' | 'Bills' | 'Health';
  source: 'google' | 'ourspace';
  syncedBy: string;
  householdId: string;
  updatedAt: string;
}

const categoryColorMap: Record<string, string> = {
  'Work': '1', // Blue
  'Personal': '2', // Green
  'Date Night': '3', // Purple
  'Bills': '4', // Red
  'Health': '5', // Yellow
};

export async function syncGoogleCalendar(userId: string, householdId: string, accessToken: string) {
  if (!accessToken) return;

  const now = new Date();
  const timeMin = startOfMonth(now).toISOString();
  const timeMax = endOfMonth(now).toISOString();

  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API_BASE}/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Google Calendar API error: ${response.statusText}`);
    }

    const data = await response.json();
    const googleEvents = data.items || [];

    for (const gEvent of googleEvents) {
      const googleEventId = gEvent.id;
      const eventsRef = collection(db, "households", householdId, "events");
      const q = query(eventsRef, where("googleEventId", "==", googleEventId));
      const querySnapshot = await getDocs(q);

      const eventData: CalendarEvent = {
        googleEventId,
        title: gEvent.summary || "Untitled Event",
        startTime: gEvent.start.dateTime || gEvent.start.date,
        endTime: gEvent.end.dateTime || gEvent.end.date,
        notes: gEvent.description || "",
        category: 'Personal', // Default category for Google events
        source: 'google',
        syncedBy: userId,
        householdId,
        updatedAt: new Date().toISOString(),
      };

      if (querySnapshot.empty) {
        // Add new event
        const newEventRef = doc(eventsRef);
        await setDoc(newEventRef, eventData);
      } else {
        // Update existing event
        const existingDoc = querySnapshot.docs[0];
        await updateDoc(existingDoc.ref, { ...eventData });
      }
    }

    // Run conflict detection after sync
    await detectConflicts(householdId);
  } catch (error) {
    console.error("Sync error:", error);
  }
}

export async function pushToGoogleCalendar(event: CalendarEvent, accessToken: string) {
  if (!accessToken) return null;

  const body = {
    summary: event.title,
    start: { dateTime: event.startTime },
    end: { dateTime: event.endTime },
    description: event.notes,
    colorId: categoryColorMap[event.category] || '1',
  };

  try {
    const response = await fetch(`${GOOGLE_CALENDAR_API_BASE}/calendars/primary/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Google Calendar API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.id; // googleEventId
  } catch (error) {
    console.error("Push error:", error);
    return null;
  }
}

export async function detectConflicts(householdId: string) {
  const eventsRef = collection(db, "households", householdId, "events");
  const now = new Date();
  const thirtyDaysLater = addDays(now, 30);

  const q = query(
    eventsRef,
    where("startTime", ">=", now.toISOString()),
    where("startTime", "<=", thirtyDaysLater.toISOString())
  );

  const querySnapshot = await getDocs(q);
  const events = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CalendarEvent));

  const conflicts: { eventA: string; eventB: string; id: string }[] = [];

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];

      const startA = new Date(a.startTime).getTime();
      const endA = new Date(a.endTime).getTime();
      const startB = new Date(b.startTime).getTime();
      const endB = new Date(b.endTime).getTime();

      if (startA < endB && endA > startB) {
        // Conflict found
        const conflictId = [a.id, b.id].sort().join("_");
        conflicts.push({ eventA: a.id!, eventB: b.id!, id: conflictId });
      }
    }
  }

  // Save conflicts to Firestore
  const conflictsRef = collection(db, "households", householdId, "conflicts");
  for (const conflict of conflicts) {
    await setDoc(doc(conflictsRef, conflict.id), {
      ...conflict,
      updatedAt: new Date().toISOString(),
    });
  }

  // Optional: Clean up old conflicts?
}
