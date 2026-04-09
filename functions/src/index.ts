import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();

const db = admin.firestore();
const fcm = admin.messaging();

/**
 * Helper to send notification to a user based on their preferences
 */
async function sendToUser(userId: string, prefKey: string, payload: admin.messaging.MessagingPayload) {
  const userDoc = await db.collection("users").doc(userId).get();
  if (!userDoc.exists) return;

  const userData = userDoc.data();
  const token = userData?.fcmToken;
  const prefs = userData?.notificationPrefs || {};

  if (!token || (prefs[prefKey] === false)) return;

  try {
    await fcm.sendToDevice(token, payload);
  } catch (error) {
    console.error(`Error sending notification to user ${userId}:`, error);
  }
}

// Function 1 — Partner Activity (Groceries)
export const onGroceryUpdate = functions.firestore
  .document("households/{householdId}/groceries/{itemId}")
  .onWrite(async (change, context) => {
    const { householdId } = context.params;
    const data = change.after.exists ? change.after.data() : change.before.data();
    if (!data) return;

    const household = await db.collection("households").doc(householdId).get();
    const memberIds = household.data()?.memberIds || [];
    const partnerId = memberIds.find((id: string) => id !== data.addedBy);

    if (!partnerId) return;

    const partnerDoc = await db.collection("users").doc(data.addedBy).get();
    const partnerName = partnerDoc.data()?.displayName || "Your partner";

    const payload: admin.messaging.MessagingPayload = {
      notification: {
        title: `${partnerName} added to groceries`,
        body: `Added ${data.name} to your shopping list`,
        icon: "/icons/icon-192.png",
        clickAction: "/grocery"
      }
    };

    await sendToUser(partnerId, "partnerActivity", payload);
  });

// Function 2 — New Note
export const onNoteUpdate = functions.firestore
  .document("households/{householdId}/notes/shared")
  .onWrite(async (change, context) => {
    const { householdId } = context.params;
    const data = change.after.data();
    if (!data) return;

    const household = await db.collection("households").doc(householdId).get();
    const memberIds = household.data()?.memberIds || [];
    const lastEditorId = data.lastEditedBy;
    const partnerId = memberIds.find((id: string) => id !== lastEditorId);

    if (!partnerId) return;

    const editorDoc = await db.collection("users").doc(lastEditorId).get();
    const editorName = editorDoc.data()?.displayName || "Your partner";

    const payload: admin.messaging.MessagingPayload = {
      notification: {
        title: `${editorName} updated your shared note`,
        body: data.content.substring(0, 60) + "...",
        icon: "/icons/icon-192.png",
        clickAction: "/notes"
      }
    };

    await sendToUser(partnerId, "partnerActivity", payload);
  });

// Function 3 — Upcoming Event Reminder (Daily at 8am AEST)
export const dailyEventReminder = functions.pubsub
  .schedule("0 8 * * *")
  .timeZone("Australia/Sydney")
  .onRun(async (context) => {
    const now = admin.firestore.Timestamp.now();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowTs = admin.firestore.Timestamp.fromDate(tomorrow);

    const households = await db.collection("households").get();
    
    for (const hDoc of households.docs) {
      const events = await hDoc.ref.collection("events")
        .where("startTime", ">=", now.toDate().toISOString())
        .where("startTime", "<=", tomorrowTs.toDate().toISOString())
        .get();

      for (const eventDoc of events.docs) {
        const event = eventDoc.data();
        const memberIds = hDoc.data().memberIds || [];

        const payload: admin.messaging.MessagingPayload = {
          notification: {
            title: `Tomorrow: ${event.title}`,
            body: `${event.startTime} — ${event.location || "No location set"}`,
            icon: "/icons/icon-192.png",
            clickAction: "/calendar"
          }
        };

        for (const uid of memberIds) {
          await sendToUser(uid, "eventReminders", payload);
        }
      }
    }
  });

// Function 4 — Proactive Alert
export const onProactiveAlert = functions.firestore
  .document("households/{householdId}/proactiveAlerts/{alertId}")
  .onCreate(async (snapshot, context) => {
    const { householdId } = context.params;
    const alert = snapshot.data();
    if (alert.priority !== "high") return;

    const household = await db.collection("households").doc(householdId).get();
    const memberIds = household.data()?.memberIds || [];

    const payload: admin.messaging.MessagingPayload = {
      notification: {
        title: alert.message.substring(0, 50),
        body: "Tap to view in OurSpace",
        icon: "/icons/icon-192.png",
        clickAction: "/dashboard"
      }
    };

    for (const uid of memberIds) {
      await sendToUser(uid, "relationshipAlerts", payload);
    }
  });

// Function 5 — Anniversary/Birthday (Daily at 9am AEST)
export const dailyAnniversaryCheck = functions.pubsub
  .schedule("0 9 * * *")
  .timeZone("Australia/Sydney")
  .onRun(async (context) => {
    const households = await db.collection("households").get();
    const now = new Date();
    
    for (const hDoc of households.docs) {
      const memberIds = hDoc.data().memberIds || [];
      
      for (const uid of memberIds) {
        const userDoc = await db.collection("users").doc(uid).get();
        const userData = userDoc.data();
        if (!userData) continue;

        const dates = [
          { value: userData.anniversary, label: "anniversary" },
          { value: userData.birthday, label: "birthday" }
        ];

        for (const dateObj of dates) {
          if (!dateObj.value) continue;
          
          const eventDate = new Date(dateObj.value);
          const nextEvent = new Date(now.getFullYear(), eventDate.getMonth(), eventDate.getDate());
          
          if (nextEvent < now) {
            nextEvent.setFullYear(now.getFullYear() + 1);
          }

          const diffTime = nextEvent.getTime() - now.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays === 7 || diffDays === 1) {
            const payload: admin.messaging.MessagingPayload = {
              notification: {
                title: `🎉 ${diffDays} days until your ${dateObj.label}`,
                body: "Start planning something special",
                icon: "/icons/icon-192.png",
                clickAction: "/together"
              }
            };
            await sendToUser(uid, "anniversaryReminders", payload);
          }
        }
      }
    }
  });

// Function 6 — Weekly Summary Ready
export const onWeeklySummary = functions.firestore
  .document("households/{householdId}/weeklySummary/latest")
  .onWrite(async (change, context) => {
    const { householdId } = context.params;
    const data = change.after.data();
    if (!data) return;

    const household = await db.collection("households").doc(householdId).get();
    const memberIds = household.data()?.memberIds || [];

    const payload: admin.messaging.MessagingPayload = {
      notification: {
        title: "Your week in review is ready ✨",
        body: data.narrative.substring(0, 80),
        icon: "/icons/icon-192.png",
        clickAction: "/dashboard"
      }
    };

    for (const uid of memberIds) {
      await sendToUser(uid, "weeklySummary", payload);
    }
  });
