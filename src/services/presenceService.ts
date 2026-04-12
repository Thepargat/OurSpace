import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

/**
 * Presence Tracking Service
 * 
 * Uses Firestore to track online/offline status.
 * Writes `isOnline`, `lastOnlineAt`, and `lastOfflineAt` to the user document.
 * 
 * The heartbeat animation on the dashboard reads these fields
 * to determine the emotional state of the connection:
 * - Both online → beating strong
 * - Only one online → fading, slowing
 * - Both offline → still, grey
 */

export async function startPresenceTracking(userId: string): Promise<() => void> {
  const userRef = doc(db, "users", userId);

  // Mark user as online
  const goOnline = async () => {
    try {
      await updateDoc(userRef, {
        isOnline: true,
        lastOnlineAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("Presence: failed to go online", err);
    }
  };

  // Mark user as offline
  const goOffline = async () => {
    try {
      await updateDoc(userRef, {
        isOnline: false,
        lastOfflineAt: new Date().toISOString(),
      });
    } catch (err) {
      console.warn("Presence: failed to go offline", err);
    }
  };

  // Go online immediately
  await goOnline();

  // Heartbeat: refresh the online timestamp every 30 seconds
  const heartbeatInterval = setInterval(() => {
    updateDoc(userRef, {
      lastOnlineAt: new Date().toISOString(),
    }).catch(() => { /* ignore */ });
  }, 30_000);

  // Browser visibility events
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      goOnline();
    } else {
      goOffline();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  // Browser close/unload
  const handleBeforeUnload = () => {
    // Use sendBeacon for reliability on page unload
    const payload = JSON.stringify({ isOnline: false, lastOfflineAt: new Date().toISOString() });
    // Fallback: try updateDoc synchronously (best effort)
    goOffline();
  };
  window.addEventListener("beforeunload", handleBeforeUnload);

  // Cleanup function
  return () => {
    clearInterval(heartbeatInterval);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("beforeunload", handleBeforeUnload);
    goOffline();
  };
}
