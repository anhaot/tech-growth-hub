import React, { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { type AIReply, exportFilename, repliesToMarkdown } from "../ai-export";
import { exportFile } from "../export-file";
import { Button, Empty, IconButton, Notice, messageOf, styles } from "./ui";
import { colors, spacing } from "../theme";

export function AIExport({
  visible,
  replies,
  onClose,
  onDelete,
}: {
  visible: boolean;
  replies: AIReply[];
  onClose: () => void;
  onDelete: (ids: string[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setError("");
      setConfirmDelete(false);
    }
  }, [visible]);
  const items = replies.filter((reply) => selected.has(reply.id));
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
      <SafeAreaView style={[styles.page, { backgroundColor: colors.white }]}>
        <View
          style={[
            styles.row,
            { paddingHorizontal: spacing.edge, paddingVertical: spacing.sm },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.heading}>AI 答疑记录</Text>
            <Text style={styles.muted}>
              已保存 {replies.length} 条 · 已选 {items.length} 条
            </Text>
          </View>
          <IconButton label="关闭记录" icon="close" disabled={busy} onPress={onClose} />
        </View>
        <View style={[styles.row, { paddingHorizontal: spacing.edge }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="全选记录"
            disabled={busy}
            onPress={() => {
              setConfirmDelete(false);
              setSelected(new Set(replies.map((reply) => reply.id)));
            }}
            style={{ paddingVertical: spacing.md }}
          >
            <Text style={{ color: colors.primary }}>全选</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="取消全选"
            disabled={busy}
            onPress={() => { setConfirmDelete(false); setSelected(new Set()); }}
            style={{ padding: spacing.md }}
          >
            <Text style={styles.muted}>取消全选</Text>
          </Pressable>
        </View>
        <FlatList
          data={[...replies].reverse()}
          keyExtractor={(reply) => reply.id}
          contentContainerStyle={[styles.content, { paddingTop: 0 }]}
          ListHeaderComponent={<Notice message={error} />}
          ListEmptyComponent={
            <Empty
              title="还没有答疑记录"
              description="AI 回复后会自动保存，可跨题目选择导出。"
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`选择答疑：${item.prompt}`}
              accessibilityState={{
                checked: selected.has(item.id),
                disabled: busy,
              }}
              disabled={busy}
              onPress={() =>
                setSelected((current) => {
                  setConfirmDelete(false);
                  const next = new Set(current);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                })
              }
              style={[
                styles.row,
                {
                  paddingVertical: spacing.lg,
                  alignItems: "flex-start",
                  borderBottomWidth: 1,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons
                name={selected.has(item.id) ? "checkbox" : "square-outline"}
                size={24}
                color={selected.has(item.id) ? colors.primary : colors.muted}
              />
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text
                  style={[styles.body, { fontWeight: "600" }]}
                  numberOfLines={2}
                >
                  {item.questionTitle}
                </Text>
                <Text style={styles.body} numberOfLines={2}>
                  {item.prompt}
                </Text>
                <Text style={styles.muted} numberOfLines={3}>
                  {item.content
                    .replace(/[#*`>|]/g, "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 180)}
                </Text>
                <Text style={styles.muted}>
                  {new Date(item.createdAt).toLocaleString("zh-CN")}
                </Text>
              </View>
            </Pressable>
          )}
        />
        <View
          style={{
            padding: spacing.edge,
            borderTopWidth: 1,
            borderColor: colors.border,
            gap: spacing.sm,
          }}
        >
          <Button
            label={`导出选中 ${items.length} 条`}
            icon="download-outline"
            busy={busy}
            disabled={!items.length}
            onPress={() => {
              setBusy(true);
              setError("");
              void exportFile(exportFilename(items), repliesToMarkdown(items))
                .catch((error) => setError(messageOf(error)))
                .finally(() => setBusy(false));
            }}
          />
          {confirmDelete ? (
            <>
              <Text style={styles.body}>删除选中的 {items.length} 条答疑记录？删除后无法恢复。</Text>
              <Button
                label="确认删除记录"
                busy={busy}
                disabled={!items.length}
                onPress={() => {
                  setBusy(true);
                  setError("");
                  void onDelete(items.map((reply) => reply.id))
                    .then(() => { setSelected(new Set()); setConfirmDelete(false); })
                    .catch((error) => setError(messageOf(error)))
                    .finally(() => setBusy(false));
                }}
              />
              <Button label="取消删除" secondary disabled={busy} onPress={() => setConfirmDelete(false)} />
            </>
          ) : (
            <Button label={`删除选中 ${items.length} 条`} icon="trash-outline" secondary disabled={busy || !items.length} onPress={() => setConfirmDelete(true)} />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}
