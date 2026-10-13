import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useClient } from "../session";
import { useStudy } from "../study";
import { permitted, type Question } from "../types";
import { Button, Field, IconButton, Notice, messageOf, styles } from "./ui";
import { ModelAction, ModelSheet } from "./ModelSheet";
import { Markdown } from "./Markdown";
import { colors } from "../theme";

export function QuestionActions({ question, categoryId, visible, onClose, onUpdated, onDeleted }: {
  question: Question;
  categoryId?: string;
  visible: boolean;
  onClose: () => void;
  onUpdated: (question: Question) => void;
  onDeleted: (next: Question | null) => void;
}) {
  const { user, api } = useClient();
  const { repository, offline, provider } = useStudy();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiBusy, setAIBusy] = useState<'answer' | 'explanation' | null>(null);
  const [preview, setPreview] = useState<{ field: 'answer' | 'explanation'; content: string; truncated: boolean } | null>(null);
  const pending = useRef<AbortController | null>(null);
  const editorScroll = useRef<ScrollView>(null);
  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setAIBusy(null);
    setPreview(null);
    if (!visible) return;
    setEditing(false);
    setConfirming(false);
    setError("");
    setAnswer(question.answer);
    setExplanation(question.explanation || "");
  }, [visible, question]);
  useEffect(() => () => pending.current?.abort(), []);
  const close = () => {
    if (busy) return;
    pending.current?.abort();
    pending.current = null;
    onClose();
  };
  async function supplement(field: 'answer' | 'explanation') {
    if (busy || aiBusy || offline) return;
    const controller = new AbortController();
    pending.current = controller;
    setAIBusy(field);
    setPreview(null);
    setError("");
    try {
      const result = await api.supplementQuestion({ questionId: question.id, field, answer, explanation, ...(provider ? { provider } : {}) }, controller.signal);
      if (pending.current === controller) setPreview({ field, content: result.result, truncated: result.truncated });
    } catch (err) {
      if (pending.current === controller) setError(messageOf(err));
    } finally {
      if (pending.current === controller) { pending.current = null; setAIBusy(null); }
    }
  }
  function aiIcon(field: 'answer' | 'explanation') {
    if (!permitted(user, "ai_polish")) return undefined;
    const label = field === 'answer' ? '参考答案' : '思路解析';
    return <Pressable accessibilityRole="button" accessibilityLabel={`AI补充${label}`} disabled={busy || Boolean(aiBusy) || offline} onPress={() => void supplement(field)} style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4, opacity: busy || offline ? 0.5 : 1 }}>
      {aiBusy === field ? <ActivityIndicator size="small" color={colors.ai} /> : <Ionicons name="sparkles-outline" size={18} color={colors.ai} />}
      <Text style={{ color: colors.ai, fontSize: 12 }}>AI</Text>
    </Pressable>;
  }
  function previewFor(field: 'answer' | 'explanation') {
    if (!preview || preview.field !== field) return null;
    return <View style={[styles.card, { backgroundColor: colors.aiSoft }]} testID={`supplement-preview-${field}`} onLayout={(event) => editorScroll.current?.scrollTo({ y: Math.max(0, event.nativeEvent.layout.y - 16), animated: true })}>
      <Text style={styles.heading}>{field === 'answer' ? '参考答案' : '思路解析'} · AI补充预览</Text>
      <Markdown>{preview.content}</Markdown>
      {preview.truncated && <Notice message="补充结果尚未完整生成，请重新生成后采用。" />}
      <Button label="采用补充结果" disabled={preview.truncated} onPress={() => {
        if (field === 'answer') setAnswer(preview.content); else setExplanation(preview.content);
        setPreview(null);
      }} />
      <Button label="重新生成补充" secondary onPress={() => void supplement(field)} />
      <Button label="放弃补充" secondary onPress={() => setPreview(null)} />
    </View>;
  }
  return (
    <>
      <ModelSheet title={confirming ? "删除这道题？" : "题目操作"} visible={visible && !editing} onClose={close}>
        <View style={{ gap: 12 }}>
          <Text style={styles.body}>{question.title}</Text>
          <Notice message={error} />
          {offline && <Text style={styles.muted}>请联网后编辑或删除题目。</Text>}
          {confirming ? (
            <>
              <Text style={styles.body}>删除后，所有使用此题库的客户端将无法再访问此题，相关学习记录和收藏也会移除。此操作无法恢复。</Text>
              <Button label="确认删除题目" busy={busy} disabled={offline} onPress={() => {
                setBusy(true);
                setError("");
                void (async () => {
                  const next = await repository.adjacent(question.id, "next", categoryId).catch(() => null)
                    || await repository.adjacent(question.id, "prev", categoryId).catch(() => null);
                  await repository.deleteQuestion(question.id);
                  onClose();
                  onDeleted(next);
                })()
                  .catch((err) => setError(messageOf(err)))
                  .finally(() => setBusy(false));
              }} />
              <Button label="取消删除" secondary disabled={busy} onPress={() => setConfirming(false)} />
            </>
          ) : (
            <>
              {permitted(user, "question_edit_content") && <ModelAction label="修改答案和解析" icon="create-outline" disabled={offline || busy} onPress={() => setEditing(true)} />}
              {permitted(user, "question_delete") && <ModelAction label="删除题目" icon="trash-outline" danger disabled={offline || busy} onPress={() => setConfirming(true)} />}
            </>
          )}
        </View>
      </ModelSheet>
      <Modal visible={visible && editing} animationType="slide" onRequestClose={close}>
        <SafeAreaView style={styles.page}>
          <View style={[styles.row, { padding: 16 }]}>
            <Text style={[styles.heading, { flex: 1 }]}>修改答案和解析</Text>
            <IconButton label="关闭题目编辑" icon="close" disabled={busy} onPress={close} />
          </View>
          <ScrollView ref={editorScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Text style={styles.body}>{question.title}</Text>
            <Notice message={error} />
            <Field label="参考答案" labelAction={aiIcon('answer')} value={answer} onChangeText={(value) => { setAnswer(value); setPreview(null); }} multiline editable={!busy && !aiBusy} maxLength={50000} style={{ minHeight: 220, textAlignVertical: "top" }} />
            {previewFor('answer')}
            <Field label="思路解析" labelAction={aiIcon('explanation')} value={explanation} onChangeText={(value) => { setExplanation(value); setPreview(null); }} multiline editable={!busy && !aiBusy} maxLength={50000} style={{ minHeight: 160, textAlignVertical: "top" }} />
            {previewFor('explanation')}
            {aiBusy && <Button label="取消AI生成" secondary onPress={() => { pending.current?.abort(); pending.current = null; setAIBusy(null); }} />}
            <Button label="保存修改" busy={busy} disabled={offline || Boolean(aiBusy)} onPress={() => {
              setBusy(true);
              setError("");
              void repository.updateQuestion(question.id, { answer, explanation, expectedRevision: question.revision })
                .then((saved) => { onUpdated(saved); onClose(); })
                .catch((err) => setError(messageOf(err)))
                .finally(() => setBusy(false));
            }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
