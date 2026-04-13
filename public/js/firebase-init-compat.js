/**
 * Firebase Init - Compatibility Version
 * For pages using traditional script loading (non-module)
 * Uses Firebase Compat SDKs
 */

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCCUQG-BNwldxOziMUNrJXZjooaXiJpbkY",
  authDomain: "the-unemployed-trio.firebaseapp.com",
  projectId: "the-unemployed-trio",
  storageBucket: "the-unemployed-trio.firebasestorage.app",
  messagingSenderId: "286947399043",
  appId: "1:286947399043:web:df2665077aec576bbd52b6",
  measurementId: "G-5PLE98LG1Y"
};

// Initialize Firebase (using global firebase from compat SDK)
const app = firebase.initializeApp(firebaseConfig);
const analytics = firebase.analytics();
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Global exposure for other scripts
window.firebaseApp = app;
window.firebaseAnalytics = analytics;
window.auth = auth;
window.db = db;
window.storage = storage;

// Helper object for Firestore operations (matching ES6 module API)
window.firebase.firestore = {
  query: (ref, ...constraints) => firebase.firestore().query(ref, ...constraints),
  where: (field, op, value) => firebase.firestore.FieldPath.where(field, op, value),
  orderBy: (field, dir) => firebase.firestore().orderBy(field, dir),
  limit: (n) => firebase.firestore().limit(n),
  collection: (db, path) => db.collection(path),
  doc: (db, ...path) => path.length === 1 ? db.doc(path[0]) : db.collection(path[0]).doc(path[1]),
  getDocs: (q) => q.get(),
  getDoc: (ref) => ref.get(),
  addDoc: (ref, data) => ref.add(data),
  updateDoc: (ref, data) => ref.update(data),
  setDoc: (ref, data, options) => ref.set(data, options || {}),
  serverTimestamp: () => firebase.firestore.FieldValue.serverTimestamp(),
  onSnapshot: (ref, cb) => ref.onSnapshot(cb),
  startAfter: (doc) => firebase.firestore().startAfter(doc),
  increment: (n) => firebase.firestore.FieldValue.increment(n),
  FieldValue: firebase.firestore.FieldValue
};

console.log('[Firebase Compat] Initialized successfully');
