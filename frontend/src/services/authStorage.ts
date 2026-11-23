/**
 * Authentication Storage Utility (Migrated to HttpOnly Cookies).
 *
 * Direct storage of JWTs or refresh tokens in browser-accessible storage
 * (sessionStorage / localStorage) is prohibited in healthcare applications.
 *
 * Authentication state is maintained via secure HttpOnly cookies set by the backend.
 * Only the non-HttpOnly CSRF cookie is read for double-submit anti-CSRF headers.
 */

const LEGACY_TOKEN_KEY = "anvaya_access_token";

/**
 * Returns null. Access tokens are HttpOnly cookies and cannot be read by JavaScript.
 */
export function getAccessToken(): string | null {
  return null;
}

/**
 * No-op. Tokens are no longer stored in JavaScript storage.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function saveAccessToken(_token?: string): void {
  // Purposely empty to prevent storing tokens in browser-accessible storage
}

/**
 * Purges any legacy residual token from sessionStorage.
 */
export function clearAccessToken(): void {
  if (typeof window !== "undefined" && window.sessionStorage) {
    sessionStorage.removeItem(LEGACY_TOKEN_KEY);
  }
}

/**
 * Reads the non-HttpOnly CSRF cookie for Double-Submit anti-CSRF request headers.
 */
export function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)anvaya_csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
