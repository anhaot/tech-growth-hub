import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useClient } from "../session";
import { useStudy } from "../study";
import type {
  Category,
  Difficulty,
  Page,
  Question,
  RootStackParams,
} from "../types";
import { permitted } from "../types";
import {
  Button,
  Chips,
  Empty,
  Field,
  Notice,
  OfflineHint,
  QuestionCard,
  messageOf,
  styles,
} from "../components/ui";
import { colors, spacing } from "../theme";

export function LearningScreen() {
  const { user } = useClient();
  const { repository, categoryId, offline, count } = useStudy();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<Question> | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const initialized = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const canViewCategories = permitted(user, "category_view");
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(keyword.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [keyword]);
  useEffect(() => {
    setPage(1);
  }, [categoryId]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!initialized.current) setLoading(true);
      setFetching(true);
      setError("");
      void Promise.all([
        repository.questions(page, {
          keyword: search,
          categoryId,
          difficulty: (difficulty || undefined) as Difficulty | undefined,
        }),
        canViewCategories ? repository.categories() : Promise.resolve([]),
      ])
        .then(([data, categories]) => {
          if (active) {
            initialized.current = true;
            setResult(data);
            setCategories(categories);
          }
        })
        .catch((err) => {
          if (active) setError(messageOf(err));
        })
        .finally(() => {
          if (active) {
            setLoading(false);
            setRefreshing(false);
            setFetching(false);
          }
        });
      return () => {
        active = false;
      };
      // The retry counter deliberately reruns this focused request.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      repository,
      search,
      categoryId,
      difficulty,
      page,
      refresh,
      canViewCategories,
    ]),
  );
  return (
    <FlatList
      style={styles.page}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { gap: 0 }]}
      data={result?.data || []}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        setRefresh((value) => value + 1);
      }}
      ListHeaderComponent={
        <View style={{ gap: spacing.lg, marginBottom: spacing.edge }}>
          <OfflineHint offline={offline} count={count} />
          <Text style={styles.heading}>
            {categories.find((category) => category.id === categoryId)?.name ||
              "全部题库"}
          </Text>
          <View style={styles.row}>
            <Button
              label="继续背题"
              icon="play-outline"
              style={{ flex: 1 }}
              onPress={() =>
                navigation.navigate("Session", {
                  categoryId: categoryId || undefined,
                  resume: true,
                })
              }
            />
            <Button
              label="从头开始"
              secondary
              style={{ flex: 1 }}
              onPress={() =>
                navigation.navigate("Session", {
                  categoryId: categoryId || undefined,
                })
              }
            />
          </View>
          <Field
            label="搜索题目"
            icon="search-outline"
            placeholder="搜索题目、答案或知识点"
            value={keyword}
            onChangeText={setKeyword}
            returnKeyType="search"
          />
          <Chips
            options={[
              { id: "", label: "全部难度" },
              { id: "easy", label: "简单" },
              { id: "medium", label: "中等" },
              { id: "hard", label: "困难" },
            ]}
            value={difficulty}
            onChange={(value) => {
              setDifficulty(value);
              setPage(1);
            }}
          />
          <Text style={styles.muted}>
            {result ? `${result.total} 道题` : ""}
          </Text>
          <Notice
            message={error}
            retry={() => setRefresh((value) => value + 1)}
          />
        </View>
      }
      renderItem={({ item }) => (
        <QuestionCard
          question={item}
          categories={categories}
          onPress={() => navigation.navigate("Question", { id: item.id })}
        />
      )}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : !error ? (
          <Empty
            title="没有找到题目"
            description="试试其他关键词、分类或难度。"
          />
        ) : null
      }
      ListFooterComponent={
        result && result.totalPages > 1 ? (
          <View style={{ gap: spacing.md, paddingTop: spacing.edge }}>
            <Text style={[styles.muted, { textAlign: "center" }]}>
              第 {page} / {result.totalPages} 页
            </Text>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button
                  label="上一页"
                  secondary
                  stableDisabled
                  disabled={page <= 1 || fetching}
                  onPress={() => setPage((value) => value - 1)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label="下一页"
                  stableDisabled
                  disabled={page >= result.totalPages || fetching}
                  onPress={() => setPage((value) => value + 1)}
                />
              </View>
            </View>
          </View>
        ) : null
      }
    />
  );
}
