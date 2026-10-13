import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "技术成长站",
  slug: "tech-growth-hub",
  version: "1.2.7",
  icon: "./assets/icon.png",
  scheme: "techgrowthhub",
  orientation: "default",
  userInterfaceStyle: "light",
  android: {
    package: "com.techgrowthhub.mobile",
    versionCode: 10,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#2563eb",
    },
    softwareKeyboardLayoutMode: "resize",
    permissions: [],
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.VIBRATE",
    ],
  },
  plugins: [
    "expo-secure-store",
    "expo-sqlite",
    "expo-status-bar",
    ["expo-build-properties", { android: { usesCleartextTraffic: true } }],
  ],
  web: { bundler: "metro", name: "技术成长站 App 预览" },
};
export default config;
