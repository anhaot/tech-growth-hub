import { getNetworkStateAsync } from "expo-network";

export async function isConnected() {
  const state = await getNetworkStateAsync();
  // A LAN-only connection can still reach a private HTTP/IP question server.
  // Let the actual API request determine whether that server is reachable.
  return state.isConnected !== false;
}
