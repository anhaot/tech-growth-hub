import KVStore from "expo-sqlite/kv-store";

// Bulk question content belongs in SQLite, never in SecureStore.
export const dataStorage = {
  get: (key: string) => KVStore.getItem(key),
  set: (key: string, value: string) => KVStore.setItem(key, value),
  remove: (key: string) => KVStore.removeItem(key),
};
