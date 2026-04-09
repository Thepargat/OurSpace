import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, Timestamp, deleteDoc, addDoc } from "firebase/firestore";
import { db } from "../firebase";
import { startOfMonth, endOfMonth, addDays, format, parseISO } from "date-fns";

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
  createdBy: string;
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

export async function refreshGoogleToken(userId: string) {
  try {
    const tokenDoc = await getDoc(doc(db, "users", userId, "googleCalendarToken", "current"));
    if (!tokenDoc.exists()) return null;

    const { refreshToken } = tokenDoc.data();
    if (!refreshToken) return null;

    const response = await fetch("/api/refresh-google-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const newTokenData = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      updatedAt: new Date().toISOString(),
    };

    await updateDoc(doc(db, "users", userId, "googleCalendarToken", "current"), newTokenData);
    return data.access_token;
  } catch (error) {
    console.error("Silent refresh failed:", error);
    return null;
  }
}

async function getValidToken(userId: string, currentToken: string) {
  const tokenDoc = await getDoc(doc(db, "users", userId, "googleCalendarToken", "current"));
  if (!tokenDoc.exists()) return currentToken;

  const { expiresAt, accessToken } = tokenDoc.data();
  // If token expires in less than 5 minutes, refresh it
  if (Date.now() + 5 * 60 * 1000 > expiresAt) {
    const newToken = await refreshGoogleToken(userId);
    return newToken || accessToken;
  }

  return accessToken;
}

export async function syncGoogleCalendar(userId: string, householdId: string, accessToken: string) {
  const validToken = await getValidToken(userId, accessToken);
  if (!validToken) return;

  const now = new Date();
  const timeMin = startOfMonth(now).toISOString();
  const timeMax = endOfMonth(now).toISOString();

  try {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API_BASE}/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
      {
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        const refreshedToken = await refreshGoogleToken(userId);
        if (refreshedToken) {
          return syncGoogleCalendar(userId, householdId, refreshedToken);
        }
      }
      const errorBody = await response.text();
      throw new Error(`Google Calendar API error: ${response.status} - ${errorBody}`);
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
        category: 'Personal',
        source: 'google',
        createdBy: userId,
        householdId,
        updatedAt: new Date().toISOString(),
      };

      if (querySnapshot.empty) {
        await addDoc(eventsRef, eventData);
      } else {
        const existingDoc = querySnapshot.docs[0];
        await updateDoc(existingDoc.ref, { ...eventData });
      }
    }

    await detectConflicts(householdId);
  } catch (error) {
    console.error("Sync error:", error);
  }
}

export async function pushToGoogleCalendar(event: CalendarEvent, accessToken: string, userId: string) {
  const validToken = await getValidToken(userId, accessToken);
  if (!validToken) return null;

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
        Authorization: `Bearer ${validToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 401) {
        const refreshedToken = await refreshGoogleToken(userId);
        if (refreshedToken) {
          return pushToGoogleCalendar(event, refreshedToken, userId);
        }
      }
      return null;
    }

    const data = await response.json();
    return data.id;
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

      // Must be different events
      if (a.id === b.id) continue;
      // Must belong to different users
      if (a.createdBy === b.createdBy) continue;

      // Must be on the same day
      if (format(parseISO(a.startTime), 'yyyy-MM-dd') !== format(parseISO(b.startTime), 'yyyy-MM-dd')) continue;

      const startA = new Date(a.startTime).getTime();
      const endA = new Date(a.endTime).getTime();
      const startB = new Date(b.startTime).getTime();
      const endB = new Date(b.endTime).getTime();

      // Times must actually overlap
      if (startA < endB && endA > startB) {
        const conflictId = [a.id, b.id].sort().join("_");
        conflicts.push({ eventA: a.id!, eventB: b.id!, id: conflictId });
      }
    }
  }

  const conflictsRef = collection(db, "households", householdId, "conflicts");
  
  // Clear old conflicts first to avoid false positives
  const existingConflicts = await getDocs(conflictsRef);
  for (const doc of existingConflicts.docs) {
    await deleteDoc(doc.ref);
  }

  for (const conflict of conflicts) {
    await setDoc(doc(conflictsRef, conflict.id), {
      ...conflict,
      updatedAt: new Date().toISOString(),
    });
  }
}
