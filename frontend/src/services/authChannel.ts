export type AuthEventType =
  | "AUTH_LOGIN"
  | "AUTH_LOGOUT"
  | "AUTH_REFRESH"
  | "AUTH_SESSION_EXPIRED";

export type AuthEvent = {
  type: AuthEventType;
  timestamp: number;
};

type AuthEventListener = (event: AuthEvent) => void;

const CHANNEL_NAME = "anvaya_auth_channel";
const FALLBACK_STORAGE_KEY = "anvaya_auth_sync_event";

const listeners = new Set<AuthEventListener>();

let channel: BroadcastChannel | null = null;

// Initialize BroadcastChannel if supported in current browser environment
if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (messageEvent: MessageEvent<AuthEvent>) => {
      if (messageEvent.data && messageEvent.data.type) {
        notifyListeners(messageEvent.data);
      }
    };
  } catch {
    channel = null;
  }
}

// Fallback using window storage event for environments without BroadcastChannel
if (typeof window !== "undefined") {
  window.addEventListener("storage", (storageEvent: StorageEvent) => {
    if (storageEvent.key === FALLBACK_STORAGE_KEY && storageEvent.newValue) {
      try {
        const parsed = JSON.parse(storageEvent.newValue) as AuthEvent;
        if (parsed && parsed.type) {
          notifyListeners(parsed);
        }
      } catch {
        // Ignore malformed storage messages
      }
    }
  });
}

function notifyListeners(event: AuthEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (listenerError) {
      console.error("Error in auth channel listener:", listenerError);
    }
  }
}

/**
 * Broadcasts an authentication state change across all open browser tabs.
 * STRICT SECURITY: NEVER include tokens, credentials, CSRF secrets, or patient data.
 */
export function broadcastAuthEvent(type: AuthEventType): void {
  const event: AuthEvent = {
    type,
    timestamp: Date.now(),
  };

  // 1. Send via BroadcastChannel if available
  if (channel) {
    try {
      channel.postMessage(event);
    } catch {
      // Channel might be closed or detached
    }
  }

  // 2. Always write to fallback storage key to wake up any tabs using storage events
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(event));
      // Clean up after 1 second so localStorage doesn't accumulate state
      setTimeout(() => {
        try {
          window.localStorage.removeItem(FALLBACK_STORAGE_KEY);
        } catch {
          // Ignore removal errors
        }
      }, 1000);
    } catch {
      // Storage might be restricted (e.g. private mode quota)
    }
  }
}

/**
 * Subscribes a listener function to cross-tab authentication events.
 * Returns an unsubscribe callback.
 */
export function subscribeAuthEvents(listener: AuthEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
