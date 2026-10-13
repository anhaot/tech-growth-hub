import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// Only the service URL survives browser preview sessions. Native tokens use Keystore.
export const storage = {
  get: async (key: string): Promise<string | null> =>
    Platform.OS === "web"
      ? (key === "server" ? localStorage : sessionStorage).getItem(`tgh.${key}`)
      : SecureStore.getItemAsync(`tgh.${key}`),
  set: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === "web")
      (key === "server" ? localStorage : sessionStorage).setItem(
        `tgh.${key}`,
        value,
      );
    else await SecureStore.setItemAsync(`tgh.${key}`, value);
  },
  remove: async (key: string): Promise<void> => {
    if (Platform.OS === "web")
      (key === "server" ? localStorage : sessionStorage).removeItem(
        `tgh.${key}`,
      );
    else await SecureStore.deleteItemAsync(`tgh.${key}`);
  },
};
