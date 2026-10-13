import React, { useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSession, useClient } from "../session";
import { useStudy } from "../study";
import { permitted, type RootStackParams } from "../types";
import {
  Button,
  Notice,
  SettingRow,
  messageOf,
  styles,
} from "../components/ui";
import { colors, radius, spacing } from "../theme";
import { AIExport } from "../components/AIExport";
import { ModelSheet, ModelAction } from "../components/ModelSheet";

export function ProfileScreen() {
  const { user, server } = useClient();
  const { signOut } = useSession();
  const {
    repository,
    categoryId,
    categories,
    provider,
    count,
    downloadedAt,
    syncing,
    pendingCount,
    syncError,
    aiReplies,
    updateMode,
  } = useStudy();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [updateSettingsOpen, setUpdateSettingsOpen] = useState(false);
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await signOut();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      style={styles.page}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      <View style={[styles.row, { paddingVertical: spacing.md }]}>
        <View
          style={{
            height: 48,
            width: 48,
            borderRadius: radius.full,
            backgroundColor: colors.soft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={[styles.heading, { color: colors.primary }]}>
            {user.username.slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>{user.username}</Text>
          <Text selectable style={styles.muted}>
            {user.email}
          </Text>
        </View>
      </View>
      <View
        style={{
          overflow: "hidden",
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        {permitted(user, "question_view") && (
          <SettingRow
            label="学习题库"
            icon="layers-outline"
            value={
              categories.find((category) => category.id === categoryId)?.name ||
              "全部题库"
            }
            onPress={() => navigation.navigate("LibrarySettings")}
          />
        )}
        {permitted(user, "ai_use") && (
          <SettingRow
            label="AI 模型"
            icon="sparkles-outline"
            value={provider ? "已选择自定义模型" : "服务默认模型"}
            onPress={() => navigation.navigate("ModelSettings")}
          />
        )}
        {permitted(user, "ai_use") && (
          <SettingRow
            label="答疑记录"
            icon="document-text-outline"
            value={`${aiReplies.length} 条 · 导出与删除`}
            onPress={() => setExportOpen(true)}
          />
        )}
        <SettingRow
          label="题库服务"
          icon="server-outline"
          value={server}
          onPress={() => {
            void Linking.openURL(server).catch((error) =>
              setError(messageOf(error)),
            );
          }}
        />
      </View>
      {permitted(user, "question_view") && (
        <View style={styles.card}>
          <Text style={styles.heading}>离线题库</Text>
          <Text style={styles.body}>已保存 {count} 道题</Text>
          <Text style={styles.muted}>
            {downloadedAt
              ? `更新于 ${new Date(downloadedAt).toLocaleString("zh-CN")}`
              : "下载后可离线查看题目、答案和解析"}
          </Text>
          <SettingRow
            label="更新方式"
            icon="sync-outline"
            value={updateMode === "daily" ? "自动更新 · 每日" : "仅手动更新"}
            onPress={() => setUpdateSettingsOpen(true)}
          />
          <Text style={styles.muted}>
            {updateMode === "daily"
              ? "满 24 小时后台更新，也可随时手动更新。"
              : "题库按需手动更新。"}
            {"\n学习记录和收藏自动同步。"}
          </Text>
          {pendingCount > 0 && (
            <Text style={styles.muted}>{pendingCount} 条学习记录待同步</Text>
          )}
          <Notice
            message={syncError && syncError !== "当前离线" ? syncError : ""}
          />
          <Button
            label={
              syncing
                ? "正在下载…"
                : downloadedAt
                  ? "更新离线题库"
                  : "下载离线题库"
            }
            busy={syncing}
            secondary
            icon="download-outline"
            onPress={() => {
              void repository
                .sync()
                .catch((error) => setError(messageOf(error)));
            }}
          />
        </View>
      )}
      <Notice message={error} />
      <ModelSheet title="离线题库更新" visible={updateSettingsOpen} onClose={() => setUpdateSettingsOpen(false)}>
        <Text style={[styles.muted, { marginBottom: spacing.lg }]}>
          首次联网自动下载。自动模式会在打开 App、回到前台或恢复网络时，检查是否已满 24 小时；手动按钮随时更新。更新失败保留已保存的题库。
        </Text>
        {([
          { mode: "daily", label: "自动更新 · 每日", supporting: "打开或回到 App 时，满 24 小时后台更新" },
          { mode: "manual", label: "仅手动更新", supporting: "按需点击更新，减少流量和下载" },
        ] as const).map(({ mode, label, supporting }) => (
          <ModelAction key={mode} label={label} supporting={supporting} selected={updateMode === mode}
            onPress={() => {
              void repository.setPreference("updateMode", mode)
                .then(() => {
                  setUpdateSettingsOpen(false);
                  if (mode === "daily") void repository.sync({ automatic: true }).catch(() => undefined);
                })
                .catch((error) => setError(messageOf(error)));
            }} />
        ))}
      </ModelSheet>
      {confirming ? (
        <View style={styles.card}>
          <Text style={styles.body}>
            退出会清除本机离线题库和答疑记录
            {pendingCount ? "，尚未同步的记录也会清除" : ""}。
          </Text>
          <Button label="确认退出" busy={busy} onPress={() => void logout()} />
          <Button
            label="取消"
            secondary
            disabled={busy}
            onPress={() => setConfirming(false)}
          />
        </View>
      ) : (
        <Button
          label="退出登录 / 更换服务"
          secondary
          onPress={() => setConfirming(true)}
        />
      )}
      <AIExport
        visible={exportOpen}
        replies={aiReplies}
        onDelete={(ids) => repository.deleteAIReplies(ids)}
        onClose={() => setExportOpen(false)}
      />
    </ScrollView>
  );
}
