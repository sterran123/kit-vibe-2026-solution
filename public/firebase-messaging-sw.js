// Firebase Cloud Messaging Service Worker
console.log('[SW] Service Worker script loaded');

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyCCUQG-BNwldxOziMUNrJXZjooaXiJpbkY",
  authDomain: "the-unemployed-trio.firebaseapp.com",
  projectId: "the-unemployed-trio",
  storageBucket: "the-unemployed-trio.firebasestorage.app",
  messagingSenderId: "286947399043",
  appId: "1:286947399043:web:df2665077aec576bbd52b6",
  measurementId: "G-5PLE98LG1Y"
};

// Service Worker Install Event
self.addEventListener('install', (event) => {
  console.log('[SW] Install event triggered');
  self.skipWaiting();
});

// Service Worker Activate Event
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event triggered');
  event.waitUntil(self.clients.claim());
});

let messaging;
try {
  firebase.initializeApp(firebaseConfig);
  console.log('[SW] Firebase initialized successfully');
  messaging = firebase.messaging();
  console.log('[SW] Firebase Messaging initialized');
} catch (e) {
  console.error('[SW] Firebase initialization failed:', e);
}

// Handle background messages
if (messaging) {
  messaging.onBackgroundMessage((payload) => {
    console.log('[SW] Received background message:', payload);
    
    const notificationTitle = payload.notification?.title || 'TutorBridge 알림';
    const notificationOptions = {
      body: payload.notification?.body || '새로운 알림이 있습니다',
      icon: '/assets/logo.png',
      badge: '/assets/badge.png',
      tag: payload.data?.ticket_id || 'general',
      requireInteraction: true,
      data: payload.data
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
}

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click received:', event);
  
  event.notification.close();
  
  // Navigate to the appropriate page
  const ticketId = event.notification.data?.ticket_id;
  let url = '/';
  
  if (ticketId) {
    url = '/instructor.html';
  }
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it
      for (const client of clientList) {
        if (client.url.includes('instructor.html') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    }).catch(err => {
      console.error('[SW] Error handling notification click:', err);
    })
  );
});

console.log('[SW] Service Worker setup complete');
