import { getToken, onMessage } from "firebase/messaging";
import { doc, updateDoc, collection, query, where, limit, getDocs } from "firebase/firestore";
import { db, messaging } from "../firebase";

export interface NotificationPrefs {
  partnerActivity: boolean;
  eventReminders: boolean;
  relationshipAlerts: boolean;
  weeklySummary: boolean;
  anniversaryReminders: boolean;
  // Compatibility keys
  grocery?: boolean;
  calendar?: boolean;
  memories?: boolean;
  finances?: boolean;
  chores?: boolean;
  bucket?: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  partnerActivity: true,
  eventReminders: true,
  relationshipAlerts: true,
  weeklySummary: true,
  anniversaryReminders: true,
  grocery: true,
  calendar: true,
  memories: true,
  finances: true,
  chores: true,
  bucket: true
};

export const requestNotificationPermission = async (userId: string) => {
  try {
    const msg = await messaging();
    if (!msg) return null;

    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const env = import.meta.env as Record<string, string | undefined>;
      const token = await getToken(msg, {
        vapidKey: env.VITE_APP_VAPID_KEY || env.REACT_APP_VAPID_KEY
      });

      if (token) {
        await updateDoc(doc(db, "users", userId), {
          fcmToken: token,
          notificationPrefs: DEFAULT_PREFS
        });
        return token;
      }
    }
    return null;
  } catch (error) {
    console.error("Error requesting notification permission:", error);
    return null;
  }
};

export const updateFCMToken = async (userId: string) => {
  try {
    const msg = await messaging();
    if (!msg) return;

    if (Notification.permission === 'granted') {
      const env = import.meta.env as Record<string, string | undefined>;
      const token = await getToken(msg, {
        vapidKey: env.VITE_APP_VAPID_KEY || env.REACT_APP_VAPID_KEY
      });
      if (token) {
        await updateDoc(doc(db, "users", userId), {
          fcmToken: token
        });
      }
    }
  } catch (error) {
    console.error("Error updating FCM token:", error);
  }
};

export const notifyPartner = async (
  householdId: string, 
  currentUserId: string, 
  title: string, 
  body: string,
  type: keyof NotificationPrefs
) => {
  if (!householdId) return;

  try {
    // 1. Find partner
    const q = query(
      collection(db, 'users'),
      where('householdId', '==', householdId),
      where('uid', '!=', currentUserId),
      limit(1)
    );
    
    const partnerSnapshot = await getDocs(q);
    if (partnerSnapshot.empty) return;

    const partnerData = partnerSnapshot.docs[0].data();
    const partnerToken = partnerData.fcmToken;
    const partnerPrefs = partnerData.notificationPrefs as NotificationPrefs;

    // 2. Check preferences
    if (!partnerToken || (partnerPrefs && !partnerPrefs[type])) return;

    // 3. Trigger FCM via Server (v1 API)
    await fetch("/api/notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: partnerToken,
        title,
        body,
        icon: "/icons/icon-192.png",
        click_action: window.location.origin
      })
    });
  } catch (error) {
    console.error("Error sending notification:", error);
  }
};

export const onForegroundMessage = (callback: (payload: any) => void) => {
  messaging().then(msg => {
    if (msg) {
      onMessage(msg, (payload) => {
        callback(payload);
      });
    }
  });
};
