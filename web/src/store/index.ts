import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { User } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, token?: string | null) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
}

const TOKEN_STORAGE_KEY = 'token';
const AUTH_STORAGE_KEY = 'auth-storage';

function getWebStorage(storage: 'localStorage' | 'sessionStorage') {
  try { return typeof window !== 'undefined' ? window[storage] : null; }
  catch { return null; }
}

function readStorage(storage: 'localStorage' | 'sessionStorage', key: string): string | null {
  try { return getWebStorage(storage)?.getItem(key) || null; } catch { return null; }
}

function writeStorage(storage: 'localStorage' | 'sessionStorage', key: string, value?: string) {
  try {
    const target = getWebStorage(storage);
    if (value === undefined) target?.removeItem(key);
    else target?.setItem(key, value);
  } catch { /* Cookie authentication still works when browser storage is unavailable. */ }
}

function getLegacyAuthSnapshot() {
  try {
    const raw = readStorage('localStorage', AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function migrateLegacyAuthState() {
  if (!getWebStorage('sessionStorage')) {
    return;
  }

  if (!getWebStorage('localStorage') || readStorage('sessionStorage', AUTH_STORAGE_KEY)) {
    return;
  }

  const legacyAuth = getLegacyAuthSnapshot();

  if (legacyAuth) {
    writeStorage('sessionStorage', AUTH_STORAGE_KEY, JSON.stringify(legacyAuth));
  }

  writeStorage('sessionStorage', TOKEN_STORAGE_KEY);
  writeStorage('localStorage', TOKEN_STORAGE_KEY);
}

function clearLegacyAuthState() {
  writeStorage('localStorage', TOKEN_STORAGE_KEY);
  writeStorage('localStorage', AUTH_STORAGE_KEY);
  writeStorage('localStorage', 'user');
}

export function clearStoredAuthState() {
  writeStorage('sessionStorage', TOKEN_STORAGE_KEY);
  writeStorage('sessionStorage', AUTH_STORAGE_KEY);

  clearLegacyAuthState();
}

export function getStoredToken(): string | null {
  writeStorage('sessionStorage', TOKEN_STORAGE_KEY);
  writeStorage('localStorage', TOKEN_STORAGE_KEY);
  return null;
}

migrateLegacyAuthState();

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setAuth: (user) => {
        writeStorage('sessionStorage', TOKEN_STORAGE_KEY);
        clearLegacyAuthState();
        set({ user, token: null, isAuthenticated: true });
      },
      logout: () => {
        clearStoredAuthState();
        set({ user: null, token: null, isAuthenticated: false });
      },
      updateUser: (userData) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        })),
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => ({
        getItem: (name) => readStorage('sessionStorage', name),
        setItem: (name, value) => writeStorage('sessionStorage', name, value),
        removeItem: (name) => writeStorage('sessionStorage', name),
      })),
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);

interface AppState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapse: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 1024 : false,
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebarCollapse: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));

interface AIState {
  enabled: boolean;
  defaultProvider: string;
  availableProviders: string[];
  setStatus: (status: { enabled: boolean; defaultProvider: string; availableProviders: string[] }) => void;
}

export const useAIStore = create<AIState>((set) => ({
  enabled: false,
  defaultProvider: 'openai',
  availableProviders: [],
  setStatus: (status) => set(status),
}));
