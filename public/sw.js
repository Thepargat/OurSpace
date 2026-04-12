importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAwH-F8niglW37Ab2jkxynU0A39BUOD-UQ",
  authDomain: "ourspace-898d8.firebaseapp.com",
  projectId: "ourspace-898d8",
  storageBucket: "ourspace-898d8.firebasestorage.app",
  messagingSenderId: "315282314755",
  appId: "1:315282314755:web:e01f8872da498151aa6036"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: payload.notification.icon || '/icons/icon-192.png',
    data: payload.data,
    tag: payload.data?.tag || 'default'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.click_action || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

const CACHE_NAME = "ourspace-v7";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&family=Outfit:wght@100..900&display=swap"
];

// Install Event
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("Pre-caching static assets");
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log("Cleaning up old cache:", cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Network-only for Firestore/Firebase (they handle their own offline state)
  if (url.hostname.includes("googleapis.com") || url.hostname.includes("firebase")) {
    return; 
  }

  // Stale-While-Revalidate for static assets and general requests
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request).then((networkResponse) => {
          if (request.method === "GET" && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(() => cachedResponse); // Fallback to cache if network fails completely

        return cachedResponse || fetchPromise;
      });
    })
  );
});
