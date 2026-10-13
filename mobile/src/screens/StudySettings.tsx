import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useClient } from "../session";
import { useStudy } from "../study";
import {
  permitted,
  type AIStatus,
  type AIConfig,
  type RootStackParams,
} from "../types";
import {
  Field,
  Notice,
  OfflineHint,
  IconButton,
  messageOf,
  styles,
} from "../components/ui";
import { ModelAction, ModelSheet } from "../components/ModelSheet";
import { modelPresets } from "../model-config";
import { colors, spacing } from "../theme";

function Choice({
  label,
  supporting,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  supporting?: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          paddingVertical: spacing.lg,
          borderBottomWidth: 1,
          borderColor: colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.6 : 1,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.body}>{label}</Text>
        {supporting && <Text style={styles.muted}>{supporting}</Text>}
      </View>
      <Ionicons
        name={selected ? "checkmark-circle" : "ellipse-outline"}
        size={23}
        color={selected ? colors.primary : colors.border}
      />
    </Pressable>
  );
}
export function LibrarySettingsScreen() {
  const { repository, categories, categoryId, offline, count } = useStudy();
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void repository
      .categories()
      .catch((error) => {
        if (active) setError(messageOf(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [repository, refresh]);
  const choices = [
    { id: "", name: "全部题库", parent_id: null },
    ...categories,
  ].filter((category) =>
    category.name.toLowerCase().includes(keyword.trim().toLowerCase()),
  );
  return (
    <FlatList
      style={styles.page}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      data={choices}
      keyExtractor={(item) => item.id || "all"}
      ListHeaderComponent={
        <View style={{ gap: spacing.md }}>
          <OfflineHint offline={offline} count={count} />
          <Field
            label="搜索题库"
            icon="search-outline"
            placeholder="题库名称"
            value={keyword}
            onChangeText={setKeyword}
          />
          <Notice
            message={error}
            retry={() => setRefresh((value) => value + 1)}
          />
          {loading && <ActivityIndicator color={colors.primary} />}
        </View>
      }
      renderItem={({ item }) => (
        <Choice
          label={item.name}
          supporting={
            item.parent_id
              ? categories.find((parent) => parent.id === item.parent_id)?.name
              : undefined
          }
          selected={categoryId === item.id}
          disabled={saving}
          onPress={() => {
            setSaving(true);
            setError("");
            void repository
              .setPreference("categoryId", item.id)
              .catch((error) => setError(messageOf(error)))
              .finally(() => setSaving(false));
          }}
        />
      )}
      ListEmptyComponent={
        !loading ? <Text style={styles.muted}>没有找到题库</Text> : null
      }
    />
  );
}
export function ModelSettingsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParams, "ModelSettings">) {
  const { api, user } = useClient();
  const { repository, provider } = useStudy();
  const manage = permitted(user, "ai_config_manage");
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [configs, setConfigs] = useState<AIConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const reload = useCallback(async () => {
    const nextStatus = await api.aiStatus();
    const nextConfigs = manage ? await api.aiConfigs() : [];
    setStatus(nextStatus);
    setConfigs(nextConfigs);
  }, [api, manage]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setError("");
      void reload()
        .catch((e) => {
          if (active) setError(messageOf(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [reload]),
  );
  const nameOf = (c: AIConfig) =>
    c.displayName && c.displayName !== c.model
      ? c.displayName
      : modelPresets.find((p) => p.url && p.url === c.baseUrl)?.name ||
        c.displayName ||
        c.provider;
  const models = manage
    ? configs.map((c) => ({
        id: c.id,
        name: nameOf(c),
        model: c.model,
        isActive: c.isActive,
      }))
    : (status?.availableModels || []).map((c) => ({
        id: c.id,
        name: c.label,
        model: "",
        isActive: false,
      }));
  const menu = configs.find((c) => c.id === menuId);
  const activeModel = configs.find((c) => c.isActive);
  async function select(id: string) {
    if (busy) return;
    setBusy(id || "default");
    setError("");
    try {
      await repository.setPreference("provider", id);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }
  async function perform(id: string, action: "activate" | "delete" | "check") {
    if (busy) return;
    setBusy(id);
    setError("");
    setNotice("");
    setMenuId(null);
    setConfirmDelete(false);
    try {
      if (action === "activate") {
        await api.activateAIConfig(id);
        await repository.setPreference("provider", id);
        setNotice("已设为服务默认模型");
      } else if (action === "delete") {
        await api.deleteAIConfig(id);
        if (provider === id) await repository.setPreference("provider", "");
        setNotice("模型配置已删除");
      } else {
        const result = await api.checkAIConfig(id);
        setNotice(
          result.status === "valid"
            ? "模型调用检查通过"
            : result.error || "模型暂时不可用",
        );
      }
      await reload();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }
  const closeMenu = () => {
    setMenuId(null);
    setConfirmDelete(false);
  };
  return (
    <>
      <FlatList
        style={[styles.page, { backgroundColor: colors.white }]}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        data={models}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={{ gap: spacing.lg }}>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={styles.muted}>选择答疑时使用的模型</Text>
              {manage && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="新增模型"
                  disabled={Boolean(busy)}
                  onPress={() => navigation.navigate("ModelEditor")}
                  style={[styles.row, { minHeight: 44 }]}
                >
                  <Ionicons name="add" color={colors.primary} size={20} />
                  <Text style={{ color: colors.primary, fontSize: 14 }}>
                    添加
                  </Text>
                </Pressable>
              )}
            </View>
            <Notice
              message={error}
              retry={() =>
                void reload()
                  .then(() => setError(""))
                  .catch((e) => setError(messageOf(e)))
              }
            />
            {loading && <ActivityIndicator color={colors.primary} />}
            {busy && (
              <View style={styles.row}>
                <ActivityIndicator color={colors.primary} size="small" />
                <Text style={styles.muted}>正在处理…</Text>
              </View>
            )}
            {notice && <Text style={styles.muted}>{notice}</Text>}
            {status && !status.enabled && (
              <Text style={styles.muted}>服务端 AI 功能已关闭</Text>
            )}
            <Choice
              label="服务默认模型"
              supporting={
                activeModel
                  ? `${nameOf(activeModel)} · ${activeModel.model}`
                  : "使用服务端当前默认配置"
              }
              selected={!provider}
              disabled={Boolean(busy)}
              onPress={() => void select("")}
            />
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.row,
              {
                alignItems: "center",
                borderBottomWidth: 1,
                borderColor: colors.border,
              },
            ]}
          >
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={`${item.name} · ${item.model}`}
              accessibilityState={{
                selected: provider === item.id,
                disabled: Boolean(busy),
              }}
              disabled={Boolean(busy)}
              onPress={() => void select(item.id)}
              style={({ pressed }) => [
                styles.row,
                {
                  flex: 1,
                  minHeight: 80,
                  paddingVertical: spacing.lg,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Ionicons
                name={
                  provider === item.id ? "checkmark-circle" : "ellipse-outline"
                }
                size={22}
                color={provider === item.id ? colors.primary : colors.border}
              />
              <View style={{ flex: 1, gap: spacing.xs }}>
                <Text style={[styles.body, { fontWeight: "600" }]}>
                  {item.name}
                </Text>
                {item.model && <Text style={styles.muted}>{item.model}</Text>}
                {item.isActive && (
                  <Text style={[styles.muted, { color: colors.primary }]}>
                    服务默认
                  </Text>
                )}
              </View>
            </Pressable>
            {manage && (
              <IconButton
                label={`管理 ${item.name}`}
                icon="ellipsis-horizontal"
                disabled={Boolean(busy)}
                onPress={() => {
                  setMenuId(item.id);
                  setConfirmDelete(false);
                }}
              />
            )}
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.muted}>
              {manage ? "还没有模型配置，点击右上角添加" : "没有可选择的模型"}
            </Text>
          ) : null
        }
      />
      <ModelSheet
        title={
          confirmDelete ? "删除模型配置？" : menu ? nameOf(menu) : "模型管理"
        }
        visible={Boolean(menu)}
        onClose={closeMenu}
      >
        {menu &&
          (confirmDelete ? (
            <>
              <Text style={[styles.body, { marginBottom: spacing.lg }]}>
                删除后将无法使用此模型，已保存的答疑记录会保留。
              </Text>
              <ModelAction
                label="确认删除模型"
                icon="trash-outline"
                danger
                onPress={() => void perform(menu.id, "delete")}
              />
              <ModelAction
                label="取消删除"
                onPress={() => setConfirmDelete(false)}
              />
            </>
          ) : (
            <>
              <Text style={[styles.muted, { marginBottom: spacing.lg }]}>
                {menu.model}
              </Text>
              <ModelAction
                label="编辑配置"
                icon="create-outline"
                onPress={() => {
                  closeMenu();
                  navigation.navigate("ModelEditor", { id: menu.id });
                }}
              />
              <ModelAction
                label="检查模型调用"
                icon="pulse-outline"
                supporting="发送一条简短请求，检查是否可用"
                onPress={() => void perform(menu.id, "check")}
              />
              {!menu.isActive && (
                <ModelAction
                  label="设为服务默认"
                  icon="checkmark-circle-outline"
                  onPress={() => void perform(menu.id, "activate")}
                />
              )}
              <ModelAction
                label="删除模型"
                icon="trash-outline"
                danger
                onPress={() => setConfirmDelete(true)}
              />
            </>
          ))}
      </ModelSheet>
    </>
  );
}
