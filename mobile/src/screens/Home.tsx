import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useClient } from "../session";
import { useStudy } from "../study";
import type { Question, RootStackParams } from "../types";
import { permitted } from "../types";
import {
  Empty,
  Notice,
  OfflineHint,
  messageOf,
  styles,
} from "../components/ui";
import { colors, radius, spacing, typography } from "../theme";

export function HomeScreen() {
  const { user } = useClient();
  const { repository, categoryId, categories, offline, count } = useStudy();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const [current, setCurrent] = useState<Question | null>(null);
  const [total, setTotal] = useState(0);
  const [bookmarked, setBookmarked] = useState(0);
  const [hasProgress, setHasProgress] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const initialized = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const canView = permitted(user, "question_view");
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!initialized.current) setLoading(true);
      setError("");
      if (!canView) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      void (async () => {
        const [page, bookmarks, last] = await Promise.all([
          repository.questions(1, { categoryId }, 1),
          repository.bookmarks(),
          repository.lastViewed(categoryId),
        ]);
        const question = last
          ? await repository.question(last.question_id)
          : page.data[0] || null;
        if (active) {
          initialized.current = true;
          setCurrent(question);
          setTotal(page.total);
          setBookmarked(bookmarks.length);
          setHasProgress(Boolean(last));
        }
      })()
        .catch((error) => {
          if (active) setError(messageOf(error));
        })
        .finally(() => {
          if (active) {
            setLoading(false);
            setRefreshing(false);
          }
        });
      return () => {
        active = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [repository, categoryId, canView, refresh]),
  );
  const library =
    categories.find((category) => category.id === categoryId)?.name ||
    "全部题库";
  return (
    <ScrollView
      style={styles.page}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.primary}
          onRefresh={() => {
            setRefreshing(true);
            setRefresh((value) => value + 1);
          }}
        />
      }
      contentContainerStyle={[styles.content, { gap: spacing.xl }]}
    >
      <OfflineHint offline={offline} count={count} />
      <Notice message={error} retry={() => setRefresh((value) => value + 1)} />
      {canView ? (
        <>
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.heroStart,
                borderWidth: 0,
                padding: spacing.xl,
                gap: spacing.lg,
              },
            ]}
          >
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text
                style={[styles.muted, { color: colors.heroMuted, flex: 1 }]}
              >
                {library}
              </Text>
              <Text style={[styles.muted, { color: colors.heroMuted }]}>
                {total} 道题
              </Text>
            </View>
            {loading && !current ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text
                style={[styles.title, { color: colors.white }]}
                numberOfLines={3}
              >
                {current?.title || "暂无题目"}
              </Text>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={hasProgress ? "继续背题" : "开始背题"}
              accessibilityState={{ disabled: !current }}
              disabled={!current}
              onPress={() =>
                navigation.navigate("Session", {
                  categoryId: categoryId || undefined,
                  resume: true,
                })
              }
              style={({ pressed }) => [
                styles.row,
                {
                  borderTopWidth: 1,
                  borderColor: colors.heroEnd,
                  paddingTop: spacing.lg,
                  minHeight: 52,
                  justifyContent: "space-between",
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={{ color: colors.white, fontSize: 16, fontWeight: "600" }}
              >
                {hasProgress ? "继续背题" : "开始背题"}
              </Text>
              <Ionicons name="arrow-forward" size={22} color={colors.white} />
            </Pressable>
          </View>
          <View
            style={[styles.row, { alignItems: "stretch", gap: spacing.md }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="查看题目"
              onPress={() => navigation.navigate("Tabs", { screen: "学习" })}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 132,
                padding: spacing.lg,
                gap: spacing.sm,
                backgroundColor: colors.white,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <View style={[styles.row, { justifyContent: "space-between" }]}>
                <Ionicons
                  name="layers-outline"
                  size={21}
                  color={colors.primary}
                />
                <Ionicons
                  name="arrow-forward"
                  size={17}
                  color={colors.primary}
                />
              </View>
              <Text style={typography.number}>{total}</Text>
              <Text style={styles.body}>浏览题库</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="查看收藏"
              onPress={() => navigation.navigate("Tabs", { screen: "收藏" })}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 132,
                padding: spacing.lg,
                gap: spacing.sm,
                backgroundColor: colors.white,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radius.md,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <View style={[styles.row, { justifyContent: "space-between" }]}>
                <Ionicons
                  name="bookmark-outline"
                  size={21}
                  color={colors.accent}
                />
                <Ionicons
                  name="arrow-forward"
                  size={17}
                  color={colors.accent}
                />
              </View>
              <Text style={typography.number}>{bookmarked}</Text>
              <Text style={styles.body}>收藏复习</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <Empty title="暂无题库访问权限" description="请联系管理员分配权限。" />
      )}
    </ScrollView>
  );
}
