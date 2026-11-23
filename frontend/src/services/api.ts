import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { getCsrfToken } from "./authStorage";
import { authService } from "./authService";

const api = axios.create({
  baseURL: "/api/v1",
  timeout: 15000,
  withCredentials: true,
  headers: {
    Accept: "application/json",
  },
});

// Request Interceptor: Attach Double-Submit CSRF token on state-changing requests
api.interceptors.request.use((config) => {
  const method = config.method?.toUpperCase();
  if (method && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      config.headers["X-CSRF-Token"] = csrfToken;
    }
  }

  return config;
});

// Queue management for in-flight session refreshes
interface QueueItem {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  config: InternalAxiosRequestConfig;
}

let isRefreshing = false;
let failedQueue: QueueItem[] = [];

const processQueue = (error: AxiosError | null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(api(prom.config));
    }
  });
  failedQueue = [];
};

// Endpoints that must never trigger automatic refresh loops
const EXCLUDED_AUTH_ENDPOINTS = [
  "/auth/login",
  "/auth/register",
  "/auth/firebase",
  "/auth/refresh",
  "/auth/logout",
];

function isExcludedAuthEndpoint(url?: string): boolean {
  if (!url) return false;
  return EXCLUDED_AUTH_ENDPOINTS.some((endpoint) => url.includes(endpoint));
}

// Guard against duplicate session expired notifications
let isHandlingSessionExpiry = false;

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;

    // Only attempt automatic refresh on HTTP 401 Unauthorized for retryable requests
    if (error.response?.status === 401 && originalRequest) {
      // Exclude authentication submission endpoints and already-retried requests
      if (
        isExcludedAuthEndpoint(originalRequest.url) ||
        originalRequest._retry
      ) {
        return Promise.reject(error);
      }

      // Mark request as retried to guarantee strictly one retry per request
      originalRequest._retry = true;

      // If a refresh is already in-flight in this browser tab, queue this request
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject, config: originalRequest });
        });
      }

      isRefreshing = true;

      try {
        await authService.refreshToken();
        processQueue(null);
        return api(originalRequest);
      } catch (refreshError: unknown) {
        if (axios.isAxiosError(refreshError)) {
          // In multi-tab concurrency, HTTP 409 Conflict indicates another tab already
          // rotated the session and updated the shared browser cookies.
          // Retry the request with the updated cookies rather than forcing logout.
          if (refreshError.response?.status === 409) {
            processQueue(null);
            return api(originalRequest);
          }

          // If refresh returned 401, the refresh token is expired or revoked.
          // Session is genuinely terminated: trigger logout and redirect to login.
          if (refreshError.response?.status === 401) {
            processQueue(refreshError);

            if (!isHandlingSessionExpiry) {
              isHandlingSessionExpiry = true;
              authService.notifySessionExpired();

              if (typeof window !== "undefined") {
                const currentPath = window.location.pathname;
                if (currentPath !== "/login" && currentPath !== "/register") {
                  const redirectTarget = encodeURIComponent(
                    currentPath + window.location.search,
                  );
                  window.location.replace(
                    `/login?session_expired=true&redirect=${redirectTarget}`,
                  );
                }
              }

              setTimeout(() => {
                isHandlingSessionExpiry = false;
              }, 2000);
            }

            return Promise.reject(refreshError);
          }

          // Network failure or temporary backend 5xx: preserve session, do NOT log out
          processQueue(refreshError);
          return Promise.reject(refreshError);
        }

        processQueue(error);
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  },
);

export default api;
