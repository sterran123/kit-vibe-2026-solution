import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, updateProfile, updatePassword, sendEmailVerification, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, addDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, updateDoc, deleteDoc, getDocs, startAfter, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCCUQG-BNwldxOziMUNrJXZjooaXiJpbkY",
  authDomain: "the-unemployed-trio.firebaseapp.com",
  projectId: "the-unemployed-trio",
  storageBucket: "the-unemployed-trio.firebasestorage.app",
  messagingSenderId: "286947399043",
  appId: "1:286947399043:web:df2665077aec576bbd52b6",
  measurementId: "G-5PLE98LG1Y"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const googleProvider = new GoogleAuthProvider();

// Global exposure for traditional script compatibility
window.auth = auth;
window.db = db;
window.storage = storage;
window.app = app;

// Firestore helpers for window.firebase.firestore compatibility
window.firebase = {
  firestore: {
    query: (ref, ...constraints) => query(ref, ...constraints),
    where: (field, op, value) => where(field, op, value),
    orderBy: (field, dir) => orderBy(field, dir),
    limit: (n) => limit(n),
    collection: (db, path) => collection(db, path),
    doc: (db, ...path) => doc(db, ...path),
    getDocs: (q) => getDocs(q),
    getDoc: (ref) => getDoc(ref),
    addDoc: (ref, data) => addDoc(ref, data),
    updateDoc: (ref, data) => updateDoc(ref, data),
    setDoc: (ref, data) => setDoc(ref, data),
    serverTimestamp: () => serverTimestamp(),
    onSnapshot: (ref, cb) => onSnapshot(ref, cb),
    startAfter: (doc) => startAfter(doc),
    increment: (n) => increment(n)
  }
};

export {
  app,
  analytics,
  auth,
  db,
  storage,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  googleProvider,
  signInWithPopup,
  updateProfile,
  updatePassword,
  sendEmailVerification,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  collection,
  doc,
  setDoc,
  getDoc,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  getDocs,
  startAfter,
  increment,
  ref,
  uploadBytes,
  getDownloadURL
};
