import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, difficultyLabel, spacing, radius, typography } from "../theme";
import type { Category, Question } from "../types";
import { tagsOf } from "../types";

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: spacing.edge,
    gap: spacing.lg,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    paddingBottom: 28,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    padding: spacing.edge,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  title: typography.title,
  heading: typography.heading,
  body: typography.body,
  muted: typography.caption,
  label: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.input,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: colors.text,
    minHeight: 48,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
export function Button({
  label,
  onPress,
  busy,
  disabled,
  stableDisabled = false,
  secondary = false,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  stableDisabled?: boolean;
  secondary?: boolean;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(busy || disabled) }}
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 48,
          paddingHorizontal: 18,
          paddingVertical: 12,
          borderRadius: radius.md,
          borderCurve: "continuous",
          backgroundColor: secondary ? colors.soft : colors.primary,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
          opacity:
            (busy || disabled) && !stableDisabled ? 0.5 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? colors.primary : colors.white} />
      ) : icon ? (
        <Ionicons
          name={icon}
          size={18}
          color={secondary ? colors.primary : colors.white}
        />
      ) : null}
      <Text
        style={{
          color: secondary ? colors.primary : colors.white,
          fontWeight: "600",
          fontSize: 14,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function IconButton({
  label,
  icon,
  onPress,
  disabled,
  stableDisabled = false,
  selected = false,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  disabled?: boolean;
  stableDisabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.sm,
        backgroundColor: selected ? colors.soft : "transparent",
        opacity: disabled && !stableDisabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons
        name={icon}
        size={21}
        color={selected ? colors.primary : colors.muted}
      />
    </Pressable>
  );
}
export function SettingRow({
  label,
  value,
  icon,
  onPress,
}: {
  label: string;
  value?: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: 72,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          backgroundColor: pressed ? colors.input : colors.white,
        },
      ]}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.sm,
          backgroundColor: colors.soft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={[styles.body, { fontWeight: "600" }]}>{label}</Text>
        {value && (
          <Text style={styles.muted} numberOfLines={2}>
            {value}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}
export function OfflineHint({
  offline,
  count,
}: {
  offline: boolean;
  count: number;
}) {
  if (!offline) return null;
  return (
    <View style={styles.row}>
      <Ionicons name="cloud-offline-outline" size={16} color={colors.muted} />
      <Text style={styles.muted}>
        {count
          ? `离线 · 已保存 ${count} 道题`
          : "尚未下载题目，请联网后在“我的”下载题库"}
      </Text>
    </View>
  );
}
export const Field = React.forwardRef<
  TextInput,
  TextInputProps & {
    label: string;
    icon?: React.ComponentProps<typeof Ionicons>["name"];
    accessory?: React.ReactNode;
    labelAction?: React.ReactNode;
  }
>(function Field({ label, icon, accessory, labelAction, onFocus, onBlur, ...props }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: spacing.sm }}>
      {labelAction ? (
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Text style={[styles.label, { marginBottom: 0, flex: 1 }]}>{label}</Text>
          {labelAction}
        </View>
      ) : <Text style={[styles.label, { marginBottom: 0 }]}>{label}</Text>}
      <View
        style={[
          styles.input,
          {
            paddingVertical: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
            borderColor: focused ? colors.primary : colors.border,
          },
        ]}
      >
        {icon && (
          <Ionicons
            name={icon}
            size={20}
            color={focused ? colors.primary : colors.muted}
          />
        )}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.muted}
          // RN Web predates submitBehavior; keep focus when advancing a form.
          {...(process.env.EXPO_OS === "web" &&
          props.submitBehavior === "submit"
            ? { blurOnSubmit: false }
            : {})}
          {...props}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            {
              flex: 1,
              minWidth: 0,
              minHeight: 52,
              fontSize: 16,
              color: colors.text,
              paddingVertical: spacing.md,
            },
            props.multiline && { minHeight: 130, textAlignVertical: "top" },
            props.style,
          ]}
        />
        {accessory}
      </View>
    </View>
  );
});
export function Notice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  if (!message) return null;
  return (
    <View
      accessibilityRole="alert"
      style={{
        padding: 14,
        backgroundColor: colors.errorSurface,
        borderRadius: 12,
        gap: 10,
      }}
    >
      <Text
        selectable
        style={{ color: colors.danger, fontSize: 14, lineHeight: 22 }}
      >
        {message}
      </Text>
      {retry && <Button label="重试" secondary onPress={retry} />}
    </View>
  );
}
export function Empty({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <View style={{ padding: 30, alignItems: "center", gap: 12 }}>
      <Ionicons name="file-tray-outline" size={36} color="#94a3b8" />
      <Text style={styles.heading}>{title}</Text>
      {description && (
        <Text style={[styles.muted, { textAlign: "center" }]}>
          {description}
        </Text>
      )}
    </View>
  );
}
export function Chips({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
      keyboardShouldPersistTaps="handled"
    >
      {options.map((option) => (
        <Pressable
          key={option.id}
          accessibilityRole="button"
          accessibilityLabel={option.label}
          accessibilityState={{ selected: value === option.id }}
          disabled={disabled}
          onPress={() => onChange(option.id)}
          style={({ pressed }) => ({
            opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
            paddingHorizontal: 16,
            minHeight: 44,
            justifyContent: "center",
            borderRadius: 22,
            backgroundColor:
              value === option.id ? colors.primary : colors.white,
            borderWidth: 1,
            borderColor: value === option.id ? colors.primary : colors.border,
          })}
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: "500",
              color: value === option.id ? colors.white : colors.muted,
            }}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
export function Metadata({
  question,
  category,
}: {
  question: Question;
  category?: string;
}) {
  return (
    <View style={styles.wrap}>
      <Text
        style={{
          color: question.difficulty === "hard" ? "#b45309" : colors.primary,
          backgroundColor: colors.soft,
          paddingHorizontal: 9,
          paddingVertical: 4,
          fontSize: 12,
          borderRadius: 6,
        }}
      >
        {difficultyLabel[question.difficulty]}
      </Text>
      {category && (
        <Text style={[styles.muted, { paddingVertical: 2 }]}>{category}</Text>
      )}
      {tagsOf(question.tags)
        .slice(0, 4)
        .map((tag) => (
          <Text key={tag} style={[styles.muted, { paddingVertical: 2 }]}>
            #{tag}
          </Text>
        ))}
    </View>
  );
}
export function QuestionCard({
  question,
  categories,
  onPress,
}: {
  question: Question;
  categories: Category[];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={question.title}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: spacing.lg,
        gap: spacing.sm,
        borderBottomWidth: 1,
        borderColor: colors.border,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View style={styles.row}>
        <Text
          numberOfLines={3}
          style={[styles.heading, { fontSize: 16, flex: 1 }]}
        >
          {question.title}
        </Text>
        <Ionicons name="chevron-forward" size={17} color={colors.muted} />
      </View>
      <Text style={styles.muted}>
        {[
          categories.find((category) => category.id === question.category_id)
            ?.name,
          difficultyLabel[question.difficulty],
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </Pressable>
  );
}
export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试";
}
