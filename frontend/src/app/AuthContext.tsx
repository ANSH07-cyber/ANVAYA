import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import axios from "axios";

import { authService } from "../services/authService";
import { subscribeAuthEvents } from "../services/authChannel";

import type {
  LoginRequest,
  RegisterRequest,
  UserPublic,
} from "../types/auth";

type AuthContextValue = {
  user: UserPublic | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  connectionError: string | null;
  retryConnection: () => Promise<void>;
  refreshUser: () => Promise<void>;
  login: (payload: LoginRequest) => Promise<UserPublic>;
  register: (payload: RegisterRequest) => Promise<UserPublic>;
  loginWithGoogle: () => Promise<UserPublic>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const currentUser = await authService.getCurrentUser();
      setUser(currentUser);
      setConnectionError(null);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        if (err.response?.status === 401) {
          // Token is genuinely invalid or expired
          await authService.logout().catch(() => undefined);
          setUser(null);
          setConnectionError(null);
        } else if (
          !err.response || // Network connection failure or server unreachable
          err.code === "ECONNABORTED" || // Request timed out
          (err.response.status >= 500 && err.response.status <= 599) // Server 5xx error
        ) {
          // Preserve credentials in cookies; do NOT call authService.logout().
          // Clear user so unverified protected patient/clinical info is NOT rendered.
          setUser(null);
          setConnectionError(
            "Unable to reach the healthcare backend service. Your credentials remain active. Please check your network or try reconnecting.",
          );
        } else {
          // Client-side access denial (e.g. 403) or malformed response
          await authService.logout().catch(() => undefined);
          setUser(null);
          setConnectionError(null);
        }
      } else {
        await authService.logout().catch(() => undefined);
        setUser(null);
        setConnectionError(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Listen to session expired notifications from Axios 401 interceptor
  useEffect(() => {
    const unsubscribe = authService.onSessionExpired(() => {
      setUser(null);
      setConnectionError(null);
    });
    return unsubscribe;
  }, []);

  // Subscribe to multi-tab auth channel events (BroadcastChannel / localStorage fallback)
  useEffect(() => {
    const unsubscribe = subscribeAuthEvents((event) => {
      if (event.type === "AUTH_LOGIN" || event.type === "AUTH_REFRESH") {
        // Another tab logged in or refreshed cookies: re-hydrate user in this tab
        authService
          .getCurrentUser()
          .then((currentUser) => {
            setUser(currentUser);
            setConnectionError(null);
          })
          .catch(() => {
            // Keep current state if transient error
          });
      } else if (event.type === "AUTH_LOGOUT" || event.type === "AUTH_SESSION_EXPIRED") {
        // Another tab logged out or session expired: immediately synchronize local state
        setUser(null);
        setConnectionError(null);
      }
    });
    return unsubscribe;
  }, []);

  // Initial session hydration on mount via HttpOnly cookie verification
  useEffect(() => {
    let isMounted = true;
    authService
      .getCurrentUser()
      .then((currentUser) => {
        if (isMounted) {
          setUser(currentUser);
          setConnectionError(null);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        if (axios.isAxiosError(err)) {
          if (err.response?.status === 401) {
            // No active session or cookie expired
            setUser(null);
            setConnectionError(null);
          } else if (
            !err.response ||
            err.code === "ECONNABORTED" ||
            (err.response.status >= 500 && err.response.status <= 599)
          ) {
            // Backend unreachable or transient failure
            setUser(null);
            setConnectionError(
              "Unable to reach the healthcare backend service. Your credentials remain active. Please check your network or try reconnecting.",
            );
          } else {
            setUser(null);
            setConnectionError(null);
          }
        } else {
          setUser(null);
          setConnectionError(null);
        }
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const retryConnection = useCallback(async () => {
    setIsLoading(true);
    await refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (payload: LoginRequest) => {
    const authenticatedUser = await authService.login(payload);
    setUser(authenticatedUser);
    setConnectionError(null);
    return authenticatedUser;
  }, []);

  const register = useCallback(async (payload: RegisterRequest) => {
    const registeredUser = await authService.register(payload);
    setUser(registeredUser);
    setConnectionError(null);
    return registeredUser;
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const authenticatedUser = await authService.loginWithGoogle();
    setUser(authenticatedUser);
    setConnectionError(null);
    return authenticatedUser;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      setUser(null);
      setConnectionError(null);
    }
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: Boolean(user),
    connectionError,
    retryConnection,
    refreshUser,
    login,
    register,
    loginWithGoogle,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
