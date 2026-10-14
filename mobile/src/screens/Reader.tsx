import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useClient } from "../session";
import { useStudy } from "../study";
import type { Question, RootStackParams } from "../types";
import { permitted } from "../types";
import {
  Button,
  Empty,
  IconButton,
  Notice,
  OfflineHint,
  messageOf,
  styles,
} from "../components/ui";
import { Markdown } from "../components/Markdown";
import { QuestionAssistant } from "./AI";
import { QuestionActions } from "../components/QuestionActions";
import { swipeDirection } from "../question-swipe";
import { colors, difficultyLabel, spacing } from "../theme";

type Direction = "next" | "prev" | "random";
type ReaderProps = {
  id?: string;
  categoryId?: string;
  resume?: boolean;
  sequence?: boolean;
};
function Reader({
  id,
  categoryId: requestedCategory,
  resume,
  sequence,
}: ReaderProps) {
  const { user } = useClient();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const {
    repository,
    categoryId: selectedCategory,
    categories,
    offline,
    count,
  } = useStudy();
  const categoryId = id
    ? undefined
    : (requestedCategory ?? (selectedCategory || undefined));
  const insets = useSafeAreaInsets();
  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const [progressError, setProgressError] = useState("");
  const [info, setInfo] = useState("");
  const [revealed, setRevealed] = useState(true);
  const [bookmarked, setBookmarked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progressReady, setProgressReady] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [aiOpen, setAIOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [aiQuestionId, setAIQuestionId] = useState<string | null>(null);
  const scroll = useRef<ScrollView>(null);
  const pendingMove = useRef<Direction | null>(null);
  const moveLock = useRef(false);
  const currentId = useRef<string | undefined>(undefined);
  const closeAssistant = useCallback(() => {
    Keyboard.dismiss();
    setAIOpen(false);
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (!aiOpen) return;
      const back = BackHandler.addEventListener("hardwareBackPress", () => {
        closeAssistant();
        return true;
      });
      return () => back.remove();
    }, [aiOpen, closeAssistant]),
  );
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    async function load() {
      if (id) return repository.question(id);
      const last = resume ? await repository.lastViewed(categoryId) : null;
      if (last) return repository.question(last.question_id);
      const page = await repository.questions(1, { categoryId }, 1);
      return page.data[0] || null;
    }
    void load()
      .then((value) => {
        if (active) setQuestion(value);
      })
      .catch((err) => {
        if (active) setError(messageOf(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [repository, id, categoryId, resume, refresh]);

  const questionId = question?.id;
  const record = useCallback(async () => {
    if (!questionId) return;
    setProgressReady(false);
    setProgressError("");
    try {
      const progress = await repository.saveProgress(questionId);
      if (currentId.current === questionId) {
        setBookmarked(progress.is_bookmarked);
        setProgressReady(true);
      }
    } catch (err) {
      if (currentId.current === questionId)
        setProgressError(`学习记录未保存：${messageOf(err)}`);
    }
  }, [repository, questionId]);
  useEffect(() => {
    currentId.current = questionId;
    setRevealed(true);
    setBookmarked(false);
    setInfo("");
    setProgressError("");
    setAIOpen(false);
    setAIQuestionId(null);
    scroll.current?.scrollTo({ y: 0, animated: false });
    void record();
    return () => {
      currentId.current = undefined;
    };
  }, [questionId, record]);

  const toggleBookmark = useCallback(async () => {
    if (!question || !progressReady || saving || moveLock.current) return;
    const targetId = question.id;
    setSaving(true);
    setProgressError("");
    try {
      const value = await repository.saveProgress(targetId, !bookmarked);
      if (currentId.current === targetId) setBookmarked(value.is_bookmarked);
    } catch (err) {
      if (currentId.current === targetId)
        setProgressError(`收藏未保存：${messageOf(err)}`);
    } finally {
      setSaving(false);
    }
  }, [question, progressReady, saving, repository, bookmarked]);
  const categoryName = categories.find((c) => c.id === question?.category_id)?.name;
  const metadata = [categoryName, question && difficultyLabel[question.difficulty]]
    .filter(Boolean).join(" · ");
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <View style={{ flexShrink: 1, maxWidth: 240 }} testID="question-header">
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 17, fontWeight: "600" }}>
            {aiOpen ? "AI 答疑" : id ? "题目详情" : "背题复习"}
          </Text>
          {!aiOpen && metadata ? <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11, lineHeight: 16 }}>{metadata}</Text> : null}
        </View>
      ),
      headerRight: !aiOpen && question ? () => (
        <View style={styles.row}>
        <IconButton
          label={bookmarked ? "取消收藏" : "收藏"}
          stableDisabled
          icon={bookmarked ? "bookmark" : "bookmark-outline"}
          selected={bookmarked}
          disabled={!progressReady || moving || loading || saving}
          onPress={() => void toggleBookmark()}
        />
        {(permitted(user, "question_edit_content") || permitted(user, "question_delete")) && (
          <IconButton label="题目操作" icon="ellipsis-horizontal" disabled={moving || loading || saving} onPress={() => setActionsOpen(true)} />
        )}
        </View>
      ) : undefined,
    });
  }, [navigation, aiOpen, id, metadata, question, bookmarked, progressReady, moving, loading, saving, toggleBookmark, user]);
  async function move(direction: Direction) {
    if (!question || loading || saving || moveLock.current) return;
    const sourceId = question.id;
    moveLock.current = true;
    setMoving(true);
    setError("");
    setInfo("");
    pendingMove.current = null;
    try {
      const next =
        direction === "random"
          ? await repository.random(categoryId)
          : await repository.adjacent(sourceId, direction, categoryId);
      if (currentId.current !== sourceId) return;
      if (next && next.id !== sourceId) {
        // Commit the next question and its initial state together; keep the reader mounted.
        setRevealed(true);
        setProgressReady(false);
        setBookmarked(false);
        setQuestion(next);
      } else
        setInfo(
          direction === "prev"
            ? "已经是第一题了"
            : direction === "next"
              ? "已经是最后一题了"
              : "当前就是这道题",
        );
    } catch (err) {
      if (currentId.current === sourceId) {
        pendingMove.current = direction;
        setError(messageOf(err));
      }
    } finally {
      moveLock.current = false;
      setMoving(false);
    }
  }
  const nativeScroll = Gesture.Native();
  const pan = Gesture.Pan()
    .enabled(
      Boolean(
        sequence && question && !loading && !moving && !saving && !aiOpen && !actionsOpen,
      ),
    )
    .activeOffsetX([-24, 24])
    .failOffsetY([-18, 18])
    .maxPointers(1)
    .onEnd((event) => {
      const direction = swipeDirection(
        event.translationX,
        event.translationY,
        event.velocityX,
      );
      if (direction) scheduleOnRN(move, direction);
    });
  // The browser owns vertical scrolling. Native() resets web touch-action to
  // auto, which lets the browser cancel horizontal pointer events prematurely.
  const gesture =
    process.env.EXPO_OS === "web"
      ? pan
      : Gesture.Simultaneous(nativeScroll, pan);
  return (
    <View style={[styles.page, { backgroundColor: colors.white }]}>
      {question && <QuestionActions
        question={question}
        categoryId={categoryId}
        visible={actionsOpen}
        onClose={() => setActionsOpen(false)}
        onUpdated={(saved) => { setQuestion(saved); setAIQuestionId(null); }}
        onDeleted={(next) => {
          setQuestion(id ? null : next);
          setAIQuestionId(null);
          if (id) navigation.goBack();
          else if (!next) setRefresh((value) => value + 1);
        }}
      />}
      <View style={{ flex: 1, display: aiOpen ? "none" : "flex" }}>
        <GestureDetector gesture={gesture} touchAction="pan-y">
          <ScrollView
            ref={scroll}
            testID="question-reader"
            removeClippedSubviews={false}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="automatic"
            contentContainerStyle={[
              styles.content,
              { paddingBottom: spacing.xl },
            ]}
          >
            <OfflineHint offline={offline} count={count} />
            {loading && !question && (
              <ActivityIndicator color={colors.primary} />
            )}
            <Notice
              message={error}
              retry={() => {
                if (pendingMove.current) void move(pendingMove.current);
                else setRefresh((value) => value + 1);
              }}
            />
            {!loading && !error && !question && (
              <Empty
                title="当前范围暂无题目"
                description="在“我的”切换题库，或联网下载题目。"
              />
            )}
            {question && (
              <>
                <Notice message={progressError} retry={() => void record()} />
                <View testID="question-content">
                  <Markdown selectable={false} turnGesture={pan}>
                    {question.content.trim() ? question.content : "暂无题干"}
                  </Markdown>
                </View>
                <View
                  style={{
                    borderTopWidth: 1,
                    borderColor: colors.border,
                    paddingTop: spacing.md,
                    gap: spacing.sm,
                  }}
                >
                  <View
                    style={[styles.row, { justifyContent: "space-between" }]}
                  >
                    <Text style={[styles.heading, { color: colors.primary }]}>
                      答案
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        revealed ? "收起答案和解析" : "展开答案和解析"
                      }
                      onPress={() => setRevealed((value) => !value)}
                      style={({ pressed }) => ({
                        minHeight: 44,
                        paddingLeft: spacing.lg,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: spacing.xs,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Text style={styles.muted}>
                        {revealed ? "收起" : "展开"}
                      </Text>
                      <Ionicons
                        name={revealed ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={colors.muted}
                      />
                    </Pressable>
                  </View>
                  {revealed && (
                    <View testID="question-answer">
                      <Markdown selectable={false} turnGesture={pan}>
                        {question.answer?.trim() ? question.answer : "暂无答案"}
                      </Markdown>
                    </View>
                  )}
                </View>
                {revealed && question.explanation?.trim() && (
                  <View
                    style={{
                      borderTopWidth: 1,
                      borderColor: colors.border,
                      paddingTop: spacing.lg,
                      gap: spacing.sm,
                    }}
                  >
                    <Text style={[styles.heading, { color: colors.primary }]}>
                      解析
                    </Text>
                    <View testID="question-explanation">
                      <Markdown selectable={false} turnGesture={pan}>
                        {question.explanation}
                      </Markdown>
                    </View>
                  </View>
                )}
                {info && (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[styles.muted, { textAlign: "center" }]}
                  >
                    {info}
                  </Text>
                )}
              </>
            )}
          </ScrollView>
        </GestureDetector>
      </View>
      {question && aiQuestionId === question.id && (
        <View style={{ flex: 1, display: aiOpen ? "flex" : "none" }}>
          <QuestionAssistant
            key={question.id}
            question={question}
            active={aiOpen}
            onClose={closeAssistant}
          />
        </View>
      )}
      {sequence && question && !aiOpen && (
        <View
          style={{
            backgroundColor: colors.white,
            borderTopWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: spacing.md,
            paddingTop: spacing.sm,
            paddingBottom: Math.max(insets.bottom, spacing.md),
          }}
        >
          <View
            style={[
              styles.row,
              {
                width: "100%",
                maxWidth: 720,
                alignSelf: "center",
                gap: spacing.sm,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Button
                label="上一题"
                stableDisabled
                secondary
                disabled={loading || moving || saving}
                onPress={() => void move("prev")}
                style={{ paddingHorizontal: spacing.sm }}
              />
            </View>
            <IconButton
              label="随机题"
              stableDisabled
              icon="shuffle-outline"
              disabled={loading || moving || saving}
              onPress={() => void move("random")}
            />
            {permitted(user, "ai_use") && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="AI 答疑"
                accessibilityState={{ disabled: loading || moving || saving }}
                disabled={loading || moving || saving}
                onPress={() => {
                  setAIQuestionId(question.id);
                  setAIOpen(true);
                }}
                style={({ pressed }) => ({
                  minHeight: 48,
                  paddingHorizontal: spacing.md,
                  justifyContent: "center",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.xs,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Ionicons name="sparkles-outline" size={18} color={colors.ai} />
                <Text
                  style={{ color: colors.ai, fontSize: 14, fontWeight: "600" }}
                >
                  AI 答疑
                </Text>
              </Pressable>
            )}
            <View style={{ flex: 1 }}>
              <Button
                label="下一题"
                stableDisabled
                disabled={loading || moving || saving}
                onPress={() => void move("next")}
                style={{ paddingHorizontal: spacing.sm }}
              />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
export function QuestionScreen({
  route,
}: NativeStackScreenProps<RootStackParams, "Question">) {
  return <Reader id={route.params.id} sequence />;
}
export function StudySessionScreen({
  route,
}: NativeStackScreenProps<RootStackParams, "Session">) {
  return <Reader {...route.params} sequence />;
}
