import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, Timestamp, deleteDoc, addDoc } from "firebase/firestore";
import { db } from "../firebase";
import { startOfMonth, endOfMonth, addDays, format, parseISO } from "date-fns";

const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export interface CalendarEvent {
  id?: string;
  googleEventId?: string; // This is the ID in the OWNER's calendar
  googleEventIds?: Record<string, string>; // Mapping of userId -> googleEventId for shared events
  title: string;
  startTime: string; // ISO string
  endTime: string; // ISO string
  notes?: string;
  category: 'Work' | 'Personal' | 'Date Night' | 'Bills' | 'Health';
  source: 'google' | 'ourspace';
  createdBy: string;
  householdId: string;
  updatedAt: string;
  isShared?: boolean;
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
  const timeMax = endOfMonth(addDays(now, 60)).toISOString(); // Sync 2 months ahead

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
      return;
    }

    const data = await response.json();
    const googleEvents = data.items || [];
    const eventsRef = collection(db, "households", householdId, "events");

    for (const gEvent of googleEvents) {
      // Expert Logic: Check if this event was created by OurSpace via extended properties
      const ourSpaceId = gEvent.extendedProperties?.private?.ourspace_id;
      
      let existingEvent: any = null;
      if (ourSpaceId) {
        const docSnap = await getDoc(doc(db, "households", householdId, "events", ourSpaceId));
        if (docSnap.exists()) existingEvent = { id: docSnap.id, ...docSnap.data() };
      }

      // If not found by ID, try finding by googleEventId mapping for this user
      if (!existingEvent) {
        const q = query(eventsRef, where(`googleEventIds.${userId}`, "==", gEvent.id));
        const snap = await getDocs(q);
        if (!snap.empty) existingEvent = { id: snap.docs[0].id, ...snap.docs[0].data() };
      }

      // If still not found, search legacy googleEventId field
      if (!existingEvent) {
        const q = query(eventsRef, where("googleEventId", "==", gEvent.id));
        const snap = await getDocs(q);
        if (!snap.empty) existingEvent = { id: snap.docs[0].id, ...snap.docs[0].data() };
      }

      const eventData: Partial<CalendarEvent> = {
        title: gEvent.summary || "Untitled Event",
        startTime: gEvent.start.dateTime || gEvent.start.date,
        endTime: gEvent.end.dateTime || gEvent.end.date,
        notes: gEvent.description || "",
        updatedAt: new Date().toISOString(),
      };

      if (!existingEvent) {
        // New event from Google
        const newEvent: CalendarEvent = {
          ...eventData as CalendarEvent,
          googleEventId: gEvent.id,
          googleEventIds: { [userId]: gEvent.id },
          category: 'Personal',
          source: 'google',
          createdBy: userId,
          householdId,
          isShared: false
        };
        await addDoc(eventsRef, newEvent);
      } else {
        // Update existing event if Google version is newer
        // (For simplicity we just update if it changed)
        if (existingEvent.title !== eventData.title || existingEvent.startTime !== eventData.startTime) {
          await updateDoc(doc(db, "households", householdId, "events", existingEvent.id), {
            ...eventData,
            [`googleEventIds.${userId}`]: gEvent.id
          });
        }
      }
    }

    await detectConflicts(householdId);
  } catch (error) {
    console.error("Sync error:", error);
  }
}

export async function pushToGoogleCalendar(event: CalendarEvent, accessToken: string, userId: string): Promise<string | null> {
  const validToken = await getValidToken(userId, accessToken);
  if (!validToken) return null;

  const body = {
    summary: event.title,
    start: { dateTime: event.startTime },
    end: { dateTime: event.endTime },
    description: event.notes,
    colorId: categoryColorMap[event.category] || '1',
    extendedProperties: {
      private: {
        ourspace_id: event.id || 'new_event',
        created_by: event.createdBy
      }
    }
  };

  try {
    const existingGoogleId = event.googleEventIds?.[userId] || event.googleEventId;
    const url = existingGoogleId 
      ? `${GOOGLE_CALENDAR_API_BASE}/calendars/primary/events/${existingGoogleId}`
      : `${GOOGLE_CALENDAR_API_BASE}/calendars/primary/events`;
    
    const response = await fetch(url, {
      method: existingGoogleId ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${validToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 401) {
        const refreshedToken = await refreshGoogleToken(userId);
        if (refreshedToken) return pushToGoogleCalendar(event, refreshedToken, userId);
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

/**
 * Expert Sync: Pushes an event to BOTH partners if it's shared
 */
export async function syncEventToBothPartners(eventId: string, householdId: string) {
  const eventSnap = await getDoc(doc(db, "households", householdId, "events", eventId));
  if (!eventSnap.exists()) return;
  
  const event = { id: eventSnap.id, ...eventSnap.data() } as CalendarEvent;
  if (!event.isShared) return;

  const householdSnap = await getDoc(doc(db, "households", householdId));
  const memberIds = householdSnap.data()?.memberIds || [];

  for (const uid of memberIds) {
    const tokenDoc = await getDoc(doc(db, "users", uid, "googleCalendarToken", "current"));
    if (tokenDoc.exists()) {
      const { accessToken } = tokenDoc.data();
      const gId = await pushToGoogleCalendar(event, accessToken, uid);
      if (gId) {
        await updateDoc(doc(db, "households", householdId, "events", eventId), {
          [`googleEventIds.${uid}`]: gId
        });
      }
    }
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
