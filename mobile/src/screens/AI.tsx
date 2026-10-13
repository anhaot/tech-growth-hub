import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  KeyboardAvoidingView,
  useKeyboardState,
} from "react-native-keyboard-controller";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useHeaderHeight } from "@react-navigation/elements";
import { AIExport } from "../components/AIExport";
import { ModelSheet } from "../components/ModelSheet";
import { AIEmptyAnswerError } from "../api";
import { type AIReply, exportFilename, repliesToMarkdown } from "../ai-export";
import { exportFile } from "../export-file";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useClient } from "../session";
import { useStudy } from "../study";
import {
  permitted,
  type AIAction,
  type AIStatus,
  type Question,
  type RootStackParams,
} from "../types";
import {
  Button,
  IconButton,
  Notice,
  messageOf,
  styles,
} from "../components/ui";
import { Markdown } from "../components/Markdown";
import { colors, radius, spacing } from "../theme";

type Message = { role: "user" | "assistant"; content: string; reply?: AIReply };
const suggestions = [
  {
    label: "题目解析",
    action: "analyze",
    prompt: "请解析这道题，说明关键知识点和解题思路。",
  },
  {
    label: "答案扩展",
    action: "expand",
    prompt: "请扩展这道题的答案，补充例子和常见追问。",
  },
  {
    label: "知识推荐",
    action: "recommend",
    prompt: "请推荐与这道题相关的知识点，给出学习顺序。",
  },
] satisfies {
  label: string;
  action: AIAction;
  prompt: string;
}[];

export function QuestionAssistant({
  question,
  active,
  onClose,
}: {
  question: Question;
  active: boolean;
  onClose: () => void;
}) {
  const { api, user } = useClient();
  const focused = useIsFocused();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { repository, provider, aiReplies } = useStudy();
  const headerHeight = useHeaderHeight();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const revealReply = useRef<string | null>(null);
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() =>
    aiReplies
      .filter((reply) => reply.questionId === question.id)
      .flatMap((reply) => [
        { role: "user" as const, content: reply.prompt },
        { role: "assistant" as const, content: reply.content, reply },
      ]),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState("");
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState<AIEmptyAnswerError["details"] | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const scroll = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const retryRequest = useRef<{
    text: string;
    action: AIAction;
    continuation: boolean;
  } | null>(null);
  const canChat = permitted(user, "ai_chat");
  useEffect(() => {
    if (!active) {
      pending.current?.abort();
      pending.current = null;
      setBusy(false);
      setSending("");
    }
  }, [active]);
  useEffect(() => {
    if (!focused) return;
    let active = true;
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setSending("");
    setLoading(true);
    setError("");
    setDiagnostic(null);
    void (async () => {
      const value = await api.aiStatus(controller.signal);
      if (active) setStatus(value);
    })()
      .catch((error) => {
        if (active) setError(messageOf(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
      pending.current?.abort();
      pending.current = null;
    };
  }, [api, refresh, provider, focused]);

  const reset = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setSending("");
    setMessages([]);
    setInput("");
    setError("");
    setDiagnostic(null);
    setDetailsOpen(false);
  }, []);
  function cancel() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setSending("");
  }
  async function send(
    text = input.trim(),
    action: AIAction = "chat",
    continuation = false,
  ) {
    if (pending.current || !text || !status?.enabled || loading) return;
    if (action === "chat" && !canChat) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setSending(text);
    setError("");
    setDiagnostic(null);
    retryRequest.current = { text, action, continuation };
    const context = messages
      .slice(-6)
      .map(
        (item) => `${item.role === "user" ? "用户" : "助手"}：${item.content}`,
      )
      .join("\n")
      .slice(-6000);
    try {
      const response = await api.aiAction(
        question.id,
        action,
        provider || undefined,
        action === "chat"
          ? `${context ? `之前的讨论：\n${context}\n\n` : ""}本次问题：${text}`
          : undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const reply: AIReply = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        questionId: question.id,
        questionTitle: question.title,
        prompt: text,
        content: response.result,
        provider,
        createdAt: new Date().toISOString(),
        truncated: response.truncated,
      };
      revealReply.current = reply.id;
      setMessages((current) => [
        ...current,
        { role: "user", content: text },
        { role: "assistant", content: response.result, reply },
      ]);
      if (!continuation) setInput("");
      try {
        await repository.saveAIReply(reply);
        setSaveError("");
      } catch (error) {
        if (!controller.signal.aborted)
          setSaveError(`回复已生成，本机保存失败：${messageOf(error)}`);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(messageOf(error));
        setDiagnostic(error instanceof AIEmptyAnswerError ? error.details : null);
        if (!continuation) setInput(text);
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
        setSending("");
      }
    }
  }
  const enabled = Boolean(status?.enabled) && !loading;
  const selectedModel = status?.availableModels?.find(
    (model) => model.id === (provider || status.defaultConfigId),
  );
  const diagnosticText = diagnostic ? [
    "AI 空回答诊断",
    `服务：${diagnostic.server}`,
    `模型：${selectedModel?.label || diagnostic.provider}`,
    `模型配置：${diagnostic.provider}`,
    `接口：/api/ai/${diagnostic.action}`,
    `正文类型：${diagnostic.resultKind}`,
    `响应字段：${diagnostic.responseFields.join(", ") || "无"}`,
  ].join("\n") : "";
  const savedIds = new Set(aiReplies.map((reply) => reply.id));
  const unsaved = messages.flatMap((message) =>
    message.reply && !savedIds.has(message.reply.id) ? [message.reply] : [],
  );
  const exportable = [...aiReplies, ...unsaved];
  async function exportOne(reply: AIReply) {
    if (exporting) return;
    setExporting(reply.id);
    setError("");
    try {
      await exportFile(exportFilename([reply]), repliesToMarkdown([reply]));
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setExporting(null);
    }
  }
  return (
    <KeyboardAvoidingView
      testID="ai-keyboard-container"
      style={[styles.page, { backgroundColor: colors.white }]}
      behavior="height"
      keyboardVerticalOffset={headerHeight}
    >
      <View
        style={[
          styles.row,
          {
            width: "100%",
            maxWidth: 760,
            alignSelf: "center",
            paddingHorizontal: spacing.edge,
            paddingVertical: spacing.sm,
            justifyContent: "space-between",
          },
        ]}
      >
        <View style={[styles.row, { flex: 1 }]}>
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={styles.muted} numberOfLines={1}>
              {question.title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="切换答疑模型"
              onPress={() => {
                cancel();
                inputRef.current?.blur();
                navigation.navigate("ModelSettings");
              }}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text
                numberOfLines={1}
                style={{ fontSize: 12, color: colors.primary }}
              >
                {selectedModel?.label || status?.defaultProvider || "选择模型"}{" "}
                ▾
              </Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回题目"
            onPress={onClose}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: spacing.sm,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ color: colors.primary, fontSize: 13 }}>
              返回题目
            </Text>
          </Pressable>
        </View>
        <IconButton
          label="批量导出答疑"
          icon="download-outline"
          onPress={() => {
            inputRef.current?.blur();
            setExportOpen(true);
          }}
        />
        {messages.length > 0 && (
          <IconButton label="新对话" icon="create-outline" onPress={reset} />
        )}
      </View>
      <View style={{ paddingHorizontal: spacing.edge }}>
        <Notice
          message={error}
          retry={() => {
            if (!status) setRefresh((value) => value + 1);
            else if (retryRequest.current) {
              const request = retryRequest.current;
              void send(request.text, request.action, request.continuation);
            } else void send();
          }}
        />
        <Notice
          message={saveError}
          retry={() => {
            void (async () => {
              for (const reply of unsaved) await repository.saveAIReply(reply);
              setSaveError("");
            })().catch((error) => setSaveError(messageOf(error)));
          }}
        />
        {diagnostic && (
          <Pressable accessibilityRole="button" accessibilityLabel="查看错误详情" onPress={() => setDetailsOpen(true)}
            style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ color: colors.primary }}>查看错误详情</Text>
          </Pressable>
        )}
      </View>
      <ModelSheet title="AI 错误详情" visible={detailsOpen} onClose={() => setDetailsOpen(false)}>
        <Text selectable style={[styles.body, { marginBottom: spacing.lg }]}>{diagnosticText}</Text>
        <Button label="分享诊断信息" secondary onPress={() => {
          void Share.share({ message: diagnosticText }).catch((error) => setError(messageOf(error)));
        }} />
      </ModelSheet>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        removeClippedSubviews={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={process.env.EXPO_OS === "web" ? "none" : "on-drag"}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, { flexGrow: 1 }]}
      >
        {loading && <ActivityIndicator color={colors.primary} />}
        {status && !status.enabled && (
          <Notice message="AI 功能已关闭，可在“我的”查看模型设置" />
        )}
        {!canChat && (
          <Text style={styles.muted}>
            当前账号没有对话权限 ，可使用下方题目提示。
          </Text>
        )}
        {!messages.length && !busy && (
          <View
            style={{
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              gap: spacing.xl,
              paddingVertical: spacing.xxl,
            }}
          >
            <Ionicons
              name="sparkles-outline"
              size={32}
              color={colors.primary}
            />
            <Text style={styles.heading}>针对这道题，继续问 AI</Text>
            <View style={[styles.wrap, { justifyContent: "center" }]}>
              {suggestions.map((suggestion) => (
                <Pressable
                  key={suggestion.label}
                  accessibilityRole="button"
                  accessibilityLabel={suggestion.label}
                  disabled={busy || !enabled}
                  onPress={() => {
                    void send(
                      suggestion.prompt,
                      suggestion.action,
                    );
                  }}
                  style={({ pressed }) => ({
                    paddingVertical: spacing.md,
                    textAlignVertical: "top",
                    paddingHorizontal: spacing.lg,
                    borderRadius: radius.md,
                    backgroundColor: colors.input,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={styles.body}>{suggestion.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        {messages.map((message, index) => (
          <View
            key={message.reply?.id || `prompt-${index}`}
            testID={message.role === "assistant" ? "ai-reply" : undefined}
            onLayout={({ nativeEvent }) => {
              if (message.reply && revealReply.current === message.reply.id) {
                revealReply.current = null;
                scroll.current?.scrollTo({
                  y: Math.max(0, nativeEvent.layout.y - spacing.md),
                  animated: false,
                });
              }
            }}
            style={
              message.role === "user"
                ? {
                    alignSelf: "flex-end",
                    maxWidth: "90%",
                    padding: spacing.md,
                    borderRadius: radius.md,
                    backgroundColor: colors.soft,
                  }
                : { width: "100%", paddingVertical: spacing.sm }
            }
          >
            {message.role === "user" ? (
              <Text selectable style={styles.body}>
                {message.content}
              </Text>
            ) : (
              <>
                <View
                  style={[
                    styles.row,
                    {
                      justifyContent: "space-between",
                      marginBottom: spacing.sm,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.muted,
                      { color: colors.primary, fontWeight: "600" },
                    ]}
                  >
                    AI 答复
                  </Text>
                  {message.reply && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`导出第 ${Math.floor(index / 2) + 1} 条答疑`}
                      disabled={Boolean(exporting)}
                      onPress={() => void exportOne(message.reply!)}
                      style={[
                        styles.row,
                        { minHeight: 44, paddingHorizontal: spacing.sm },
                      ]}
                    >
                      <Ionicons
                        name="download-outline"
                        size={16}
                        color={colors.muted}
                      />
                      <Text style={styles.muted}>
                        {exporting === message.reply.id ? "正在导出…" : "导出"}
                      </Text>
                    </Pressable>
                  )}
                </View>
                <Markdown>{message.content}</Markdown>
                {message.reply?.truncated && (
                  <Text style={styles.muted}>
                    回答尚未完成，可以继续补全；已有内容已保留。
                  </Text>
                )}
                {index === messages.length - 1 && canChat && (
                  <Button
                    label={
                      message.reply?.truncated ? "继续补全回答" : "继续回答"
                    }
                    secondary
                    disabled={busy || !enabled}
                    onPress={() =>
                      void send(
                        "请从上一条回复的末尾继续补全回答，不要重复已有内容，保留 Markdown 和列表编号。",
                        "chat",
                        true,
                      )
                    }
                  />
                )}
              </>
            )}
          </View>
        ))}
        {busy && (
          <View
            onLayout={() => scroll.current?.scrollToEnd({ animated: false })}
            style={{ gap: spacing.md }}
          >
            <View
              style={{
                alignSelf: "flex-end",
                maxWidth: "90%",
                padding: spacing.md,
                borderRadius: radius.md,
                backgroundColor: colors.soft,
              }}
            >
              <Text selectable style={styles.body}>
                {sending}
              </Text>
            </View>
            <View style={styles.row}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.muted}>正在思考…</Text>
            </View>
          </View>
        )}
      </ScrollView>
      <View
        style={{
          borderTopWidth: 1,
          borderColor: colors.border,
          padding: spacing.md,
          paddingBottom: keyboardVisible
            ? spacing.md
            : Math.max(insets.bottom, spacing.md),
          backgroundColor: colors.white,
        }}
      >
        <View
          style={[
            styles.row,
            {
              width: "100%",
              maxWidth: 720,
              alignSelf: "center",
              alignItems: "flex-end",
            },
          ]}
        >
          <TextInput
            ref={inputRef}
            accessibilityLabel="输入学习问题"
            multiline
            maxLength={1200}
            value={input}
            onChangeText={setInput}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            editable={!busy && canChat}
            placeholder={canChat ? "输入问题…" : "当前账号没有对话权限"}
            placeholderTextColor={colors.muted}
            style={[
              styles.input,
              {
                flex: 1,
                minHeight: 48,
                maxHeight: 140,
                paddingVertical: spacing.md,
                textAlignVertical: "top",
                borderColor: inputFocused ? colors.primary : colors.border,
                outlineWidth: 0,
              },
            ]}
          />
          <IconButton
            label={busy ? "停止生成" : "发送问题"}
            icon={busy ? "stop-circle-outline" : "arrow-up-circle"}
            selected
            disabled={!busy && (!input.trim() || !enabled || !canChat)}
            onPress={() => {
              if (busy) cancel();
              else void send();
            }}
          />
        </View>
      </View>
      <AIExport
        visible={exportOpen}
        replies={exportable}
        onDelete={async (ids) => {
          await repository.deleteAIReplies(ids);
          const removed = new Set(ids);
          setMessages((current) => current.filter((message, index) => {
            if (message.reply && removed.has(message.reply.id)) return false;
            const next = current[index + 1];
            return !(message.role === "user" && next?.reply && removed.has(next.reply.id));
          }));
        }}
        onClose={() => setExportOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}
