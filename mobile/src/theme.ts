import type { TextStyle } from "react-native";

export const colors = {
  primary: "#0f766e",
  text: "#183631",
  muted: "#596f67",
  background: "#f6f7f9",
  border: "#e0e9e4",
  white: "#ffffff",
  soft: "#e8f3ee",
  input: "#f7faf8",
  danger: "#b42336",
  errorSurface: "#fff0f2",
  green: "#15803d",
  heroStart: "#174d46",
  heroEnd: "#0e7164",
  heroMuted: "#d5eee3",
  accent: "#94601f",
  accentSoft: "#fbf2e5",
  ai: "#5261a2",
  aiSoft: "#eef0fb",
};
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  edge: 20,
  xl: 24,
  xxl: 32,
  large: 48,
};
export const radius = { sm: 8, md: 14, lg: 20, xl: 28, full: 999 };
export const typography = {
  display: {
    fontSize: 32,
    fontWeight: "700",
    lineHeight: 43,
    color: colors.text,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 34,
    color: colors.text,
  },
  heading: {
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 27,
    color: colors.text,
  },
  body: { fontSize: 15, lineHeight: 25, color: colors.text },
  caption: { fontSize: 13, lineHeight: 21, color: colors.muted },
  number: {
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 36,
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
} satisfies Record<string, TextStyle>;
export const difficultyLabel = { easy: "简单", medium: "中等", hard: "困难" };
