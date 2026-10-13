import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useClient } from "../session";
import { useStudy } from "../study";
import type { Category, Question, RootStackParams } from "../types";
import { permitted } from "../types";
import {
  Empty,
  Button,
  Notice,
  OfflineHint,
  QuestionCard,
  messageOf,
  styles,
} from "../components/ui";

export function BookmarksScreen() {
  const { user } = useClient();
  const { repository, offline, count } = useStudy();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const initialized = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const canViewCategories = permitted(user, "category_view");
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!initialized.current) setLoading(true);
      setError("");
      void Promise.all([
        repository.bookmarks(),
        canViewCategories ? repository.categories() : Promise.resolve([]),
      ])
        .then(([data, categories]) => {
          if (active) {
            initialized.current = true;
            setQuestions(data);
            setSelected((current) => new Set(data.filter((q) => current.has(q.id)).map((q) => q.id)));
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
          }
        });
      return () => {
        active = false;
      };
      // The retry counter deliberately reruns this focused request.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [repository, canViewCategories, refresh]),
  );
  return (
    <FlatList
      style={styles.page}
      contentContainerStyle={[styles.content, { gap: 0 }]}
      data={questions}
      keyExtractor={(item) => item.id}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        setRefresh((value) => value + 1);
      }}
      ListHeaderComponent={
        <View style={{ gap: 14, marginBottom: 16 }}>
          <OfflineHint offline={offline} count={count} />
          <Notice
            message={error}
            retry={() => setRefresh((value) => value + 1)}
          />
          {questions.length > 0 && (
            <>
              <Button label={selecting ? "完成选择" : "批量取消收藏"} secondary disabled={busy || offline} onPress={() => {
                setSelecting((value) => !value);
                setSelected(new Set());
                setConfirming(false);
              }} />
              {selecting && (
                <>
                  <View style={styles.row}>
                    <Button label="全选" secondary disabled={busy} onPress={() => { setSelected(new Set(questions.map((q) => q.id))); setConfirming(false); }} />
                    <Button label="取消全选" secondary disabled={busy} onPress={() => { setSelected(new Set()); setConfirming(false); }} />
                    <Text style={styles.muted}>已选 {selected.size} 道</Text>
                  </View>
                  {confirming && <Text style={styles.body}>取消这 {selected.size} 道题的收藏？题目仍保留在题库中。</Text>}
                  <Button label={confirming ? "确认取消收藏" : `取消收藏 ${selected.size} 道`} busy={busy} disabled={!selected.size || offline} onPress={() => {
                    if (!confirming) { setConfirming(true); return; }
                    setBusy(true);
                    setError("");
                    void repository.removeBookmarks([...selected])
                      .then(() => { setSelected(new Set()); setConfirming(false); })
                      .catch((err) => setError(messageOf(err)))
                      .finally(() => { setBusy(false); setRefresh((value) => value + 1); });
                  }} />
                  {confirming && <Button label="取消操作" secondary disabled={busy} onPress={() => setConfirming(false)} />}
                </>
              )}
            </>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <View>
          {selecting && (
            <Pressable accessibilityRole="checkbox" accessibilityLabel={`选择收藏：${item.title}`} accessibilityState={{ checked: selected.has(item.id), disabled: busy }} disabled={busy} onPress={() => {
              setConfirming(false);
              setSelected((current) => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                return next;
              });
            }} style={{ minHeight: 44, justifyContent: "center" }}>
              <Text style={styles.body}>{selected.has(item.id) ? "☑ 已选择" : "☐ 选择此题"}</Text>
            </Pressable>
          )}
          <QuestionCard question={item} categories={categories} onPress={() => navigation.navigate("Question", { id: item.id })} />
        </View>
      )}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator />
        ) : !error ? (
          <Empty
            title="还没有收藏"
            description="在题目或学习页面点击收藏，下次从这里快速找到。"
          />
        ) : null
      }
    />
  );
}
