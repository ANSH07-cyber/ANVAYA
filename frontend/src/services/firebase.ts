import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Validate whether all required Firebase credentials are present in the environment
const missingVariables = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

export const isFirebaseConfigured: boolean = missingVariables.length === 0;

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let googleProvider: GoogleAuthProvider | null = null;

if (isFirebaseConfigured) {
  try {
    firebaseApp = getApps().length
      ? getApp()
      : initializeApp(firebaseConfig);
    firebaseAuth = getAuth(firebaseApp);
    googleProvider = new GoogleAuthProvider();
    googleProvider.setCustomParameters({
      prompt: "select_account",
    });
  } catch {
    // Graceful fallback: do not crash the application bundle if initialization fails
    firebaseApp = null;
    firebaseAuth = null;
    googleProvider = null;
  }
}

export { firebaseApp, firebaseAuth, googleProvider };
