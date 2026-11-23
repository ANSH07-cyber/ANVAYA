import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Strict fail-closed validator for the E2E API proxy destination.
 * Validates that VITE_E2E_API_PROXY_TARGET matches the exact canonical target:
 * http://127.0.0.1:8001/
 */
export function validateE2eProxyTarget(rawUrl: string | undefined): string {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new Error('[SECURITY HALT] Missing or empty VITE_E2E_API_PROXY_TARGET environment variable.');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`[SECURITY HALT] Malformed VITE_E2E_API_PROXY_TARGET URL: '${rawUrl}'.`);
  }

  if (parsed.protocol !== 'http:') {
    throw new Error(`[SECURITY HALT] Prohibited protocol '${parsed.protocol}'. Must be 'http:'.`);
  }

  if (parsed.hostname !== '127.0.0.1') {
    throw new Error(`[SECURITY HALT] Prohibited host '${parsed.hostname}'. Must be '127.0.0.1'.`);
  }

  if (parsed.port !== '8001') {
    throw new Error(`[SECURITY HALT] Prohibited port '${parsed.port}'. Must be '8001'. Port 8000 is strictly prohibited.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error('[SECURITY HALT] Credential-bearing proxy URLs are strictly prohibited.');
  }

  if (parsed.search) {
    throw new Error('[SECURITY HALT] Query strings in proxy target URL are strictly prohibited.');
  }

  if (parsed.hash) {
    throw new Error('[SECURITY HALT] Hash fragments in proxy target URL are strictly prohibited.');
  }

  if (parsed.pathname !== '/') {
    throw new Error(`[SECURITY HALT] Non-root pathname '${parsed.pathname}' prohibited. Must be '/'.`);
  }

  if (rawUrl.includes('8000') || parsed.port === '8000') {
    throw new Error('[SECURITY HALT] Target points to development backend port 8000. Strictly prohibited.');
  }

  return 'http://127.0.0.1:8001/';
}

// In standard Vite build/dev, process.env is read from process environment
const rawTarget = process.env.VITE_E2E_API_PROXY_TARGET;
const validatedTarget = validateE2eProxyTarget(rawTarget);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true, // Fail closed if port 5175 is occupied
    proxy: {
      '/api': {
        target: validatedTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
