import { signInWithPopup, signOut } from "firebase/auth";

import api from "./api";
import {
  firebaseAuth,
  googleProvider,
  isFirebaseConfigured,
} from "./firebase";
import { clearAccessToken } from "./authStorage";
import { broadcastAuthEvent } from "./authChannel";

import type {
  LoginRequest,
  RegisterRequest,
  TokenResponse,
  UserPublic,
} from "../types/auth";

async function login(payload: LoginRequest): Promise<UserPublic> {
  const response = await api.post<TokenResponse>("/auth/login", payload);
  clearAccessToken(); // Ensure no legacy token remains in sessionStorage
  broadcastAuthEvent("AUTH_LOGIN");
  return response.data.user;
}

async function register(payload: RegisterRequest): Promise<UserPublic> {
  const response = await api.post<TokenResponse>("/auth/register", payload);
  clearAccessToken();
  broadcastAuthEvent("AUTH_LOGIN");
  return response.data.user;
}

async function loginWithGoogle(): Promise<UserPublic> {
  if (!isFirebaseConfigured || !firebaseAuth || !googleProvider) {
    throw new Error("Google sign-in is not configured in this environment.");
  }

  const result = await signInWithPopup(firebaseAuth, googleProvider);

  try {
    if (!result.user.email || !result.user.emailVerified) {
      throw new Error("Please sign in with a verified Google account.");
    }

    const idToken = await result.user.getIdToken();

    const response = await api.post<TokenResponse>("/auth/firebase", {
      id_token: idToken,
    });

    clearAccessToken();
    broadcastAuthEvent("AUTH_LOGIN");
    return response.data.user;
  } catch (error) {
    if (firebaseAuth) {
      await signOut(firebaseAuth).catch(() => undefined);
    }
    throw error;
  }
}

async function getCurrentUser(): Promise<UserPublic> {
  const response = await api.get<UserPublic>("/auth/me");
  return response.data;
}

async function refreshToken(): Promise<void> {
  await api.post<TokenResponse>("/auth/refresh");
  broadcastAuthEvent("AUTH_REFRESH");
}

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

function notifySessionExpired(): void {
  clearAccessToken();
  if (firebaseAuth) {
    void signOut(firebaseAuth).catch(() => undefined);
  }
  broadcastAuthEvent("AUTH_SESSION_EXPIRED");

  for (const listener of sessionExpiredListeners) {
    try {
      listener();
    } catch (listenerError) {
      console.error("Error in session expired listener:", listenerError);
    }
  }
}

async function logout(): Promise<void> {
  try {
    await api.post("/auth/logout");
  } catch {
    // If session is already invalidated, continue with client cleanup
  }

  clearAccessToken();
  if (firebaseAuth) {
    void signOut(firebaseAuth).catch(() => undefined);
  }

  broadcastAuthEvent("AUTH_LOGOUT");
}

async function revokeAllSessions(): Promise<void> {
  try {
    await api.post("/auth/revoke-all");
  } catch {
    // If session is already invalidated, continue with client cleanup
  }

  clearAccessToken();
  if (firebaseAuth) {
    void signOut(firebaseAuth).catch(() => undefined);
  }

  broadcastAuthEvent("AUTH_LOGOUT");
}

function hasSession(): boolean {
  // With HttpOnly cookies, JavaScript assumes a session may exist and verifies via GET /auth/me
  return true;
}

function isGoogleAuthAvailable(): boolean {
  return isFirebaseConfigured;
}

export const authService = {
  login,
  register,
  loginWithGoogle,
  getCurrentUser,
  refreshToken,
  logout,
  revokeAllSessions,
  hasSession,
  isGoogleAuthAvailable,
  onSessionExpired,
  notifySessionExpired,
};
