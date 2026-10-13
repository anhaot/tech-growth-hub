import React from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, radius, spacing } from "../theme";
import { styles } from "./ui";

export function ModelSheet({
  title,
  visible,
  onClose,
  children,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "#00000044",
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭菜单"
          onPress={onClose}
          style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }}
        />
        <View
          style={{
            backgroundColor: colors.white,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            maxHeight: "85%",
            paddingHorizontal: spacing.edge,
            paddingBottom: Math.max(insets.bottom, spacing.lg),
          }}
        >
          <View
            style={[
              styles.row,
              { justifyContent: "space-between", paddingVertical: spacing.lg },
            ]}
          >
            <Text style={[styles.heading, { flex: 1 }]}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭菜单"
              onPress={onClose}
              style={{ padding: spacing.sm, minWidth: 44, minHeight: 44 }}
            >
              <Ionicons name="close" color={colors.muted} size={24} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
export function ModelAction({
  label,
  supporting,
  icon,
  selected,
  danger,
  disabled,
  onPress,
}: {
  label: string;
  supporting?: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: 60,
          paddingVertical: spacing.md,
          borderTopWidth: 1,
          borderColor: colors.border,
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        },
      ]}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={22}
          color={danger ? colors.danger : colors.primary}
        />
      )}
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text
          style={[styles.body, { color: danger ? colors.danger : colors.text }]}
        >
          {label}
        </Text>
        {supporting && <Text style={styles.muted}>{supporting}</Text>}
      </View>
      {selected && (
        <Ionicons name="checkmark" size={22} color={colors.primary} />
      )}
    </Pressable>
  );
}
