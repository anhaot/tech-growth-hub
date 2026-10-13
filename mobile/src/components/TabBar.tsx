import React from "react";
import { Pressable, Text, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, radius, spacing } from "../theme";

const icons: Record<
  string,
  [
    React.ComponentProps<typeof Ionicons>["name"],
    React.ComponentProps<typeof Ionicons>["name"],
  ]
> = {
  首页: ["home-outline", "home"],
  学习: ["book-outline", "book"],
  收藏: ["bookmark-outline", "bookmark"],
  我的: ["person-outline", "person"],
};
export function AppTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="app-tab-bar"
      style={{
        backgroundColor: colors.white,
        borderTopWidth: 1,
        borderColor: colors.border,
        paddingBottom: Math.max(insets.bottom, spacing.sm),
        paddingTop: spacing.sm,
        paddingHorizontal: spacing.sm,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          maxWidth: 760,
          width: "100%",
          alignSelf: "center",
        }}
      >
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const label = route.name === "学习" ? "背题" : route.name;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: focused }}
              onPress={() => {
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented)
                  navigation.navigate(route.name, route.params);
              }}
              onLongPress={() =>
                navigation.emit({ type: "tabLongPress", target: route.key })
              }
              testID={descriptors[route.key].options.tabBarButtonTestID}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 56,
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.xs,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View
                style={{
                  width: 52,
                  height: 30,
                  borderRadius: radius.full,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: focused ? colors.soft : colors.white,
                }}
              >
                <Ionicons
                  name={icons[route.name][focused ? 1 : 0]}
                  size={21}
                  color={focused ? colors.primary : colors.muted}
                />
              </View>
              <Text
                style={{
                  fontSize: 12,
                  lineHeight: 16,
                  fontWeight: focused ? "600" : "400",
                  color: focused ? colors.primary : colors.muted,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
