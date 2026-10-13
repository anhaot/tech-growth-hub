import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useClient } from "../session";
import { useStudy } from "../study";
import { permitted, type RootStackParams } from "../types";
import { Button, Field, Notice, messageOf, styles } from "../components/ui";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ModelSheet, ModelAction } from "../components/ModelSheet";
import { colors, spacing } from "../theme";
import { modelConfigInput, modelPresets } from "../model-config";

export function ModelEditorScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParams, "ModelEditor">) {
  const { api, user } = useClient();
  const { repository } = useStudy();
  const id = route.params?.id;
  const savedId = useRef(id);
  const headerHeight = useHeaderHeight();
  const [draft, setDraft] = useState({
    provider: "openai",
    name: "",
    baseUrl: modelPresets[0].url,
    apiKey: "",
    model: "",
  });
  const [loading, setLoading] = useState(Boolean(id));
  const [loaded, setLoaded] = useState(!id);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [picker, setPicker] = useState(false);
  const [providerPicker, setProviderPicker] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [filter, setFilter] = useState("");
  const [revealKey, setRevealKey] = useState(false);
  const allowed = permitted(user, "ai_config_manage");
  useEffect(() => {
    let mounted = true;
    if (!id) return;
    setLoading(true);
    setError("");
    void api
      .aiConfigs()
      .then((configs) => {
        const config = configs.find((value) => value.id === id);
        if (!config) throw new Error("模型配置不存在，请返回刷新");
        if (mounted) {
          setDraft({
            provider: config.provider,
            name: config.displayName || "",
            baseUrl:
              config.baseUrl ||
              modelPresets.find((p) => p.provider === config.provider)?.url ||
              "",
            apiKey: "",
            model: config.model,
          });
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (mounted) setError(messageOf(e));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [api, id, refresh]);
  const change = (key: keyof typeof draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  async function loadModels() {
    if (busy || !allowed || !loaded) return;
    setBusy(true);
    setError("");
    try {
      const input = modelConfigInput(
        { ...draft, model: draft.model || "pending" },
        Boolean(id),
      );
      const result = await api.aiModels({
        ...(id ? { configId: id } : {}),
        baseUrl: input.baseUrl!,
        apiKey: input.apiKey,
        isCustom: input.isCustom,
      });
      if (!result.models.length)
        throw new Error("服务没有返回模型列表，可以手动填写模型名称");
      setModels(result.models.map((model) => model.id));
      setFilter("");
      Keyboard.dismiss();
      setPicker(true);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (busy || !allowed || loading || !loaded) return;
    setBusy(true);
    setError("");
    try {
      const config = await api.saveAIConfig(
        modelConfigInput(draft, Boolean(savedId.current)),
        savedId.current,
      );
      savedId.current = config.id;
      if (!config.isActive) await api.activateAIConfig(config.id);
      await repository.setPreference("provider", config.id);
      setDraft((current) => ({ ...current, apiKey: "" }));
      Keyboard.dismiss();
      navigation.goBack();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  if (!allowed)
    return (
      <View style={styles.content}>
        <Notice message="当前账号没有 AI 配置权限" />
      </View>
    );
  return (
    <>
      <KeyboardAwareScrollView
        style={[styles.page, { backgroundColor: colors.white }]}
        contentContainerStyle={[styles.content, { gap: spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={headerHeight + 24}
      >
        {loading && <ActivityIndicator color={colors.primary} />}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="选择提供商"
          disabled={busy || loading}
          onPress={() => setProviderPicker(true)}
          style={[
            styles.row,
            {
              paddingVertical: spacing.md,
              borderBottomWidth: 1,
              borderColor: colors.border,
            },
          ]}
        >
          <Text style={styles.body}>提供商</Text>
          <Text
            style={[
              styles.body,
              { flex: 1, textAlign: "right", color: colors.primary },
            ]}
          >
            {modelPresets.find((p) => p.provider === draft.provider)?.name ||
              draft.provider}
          </Text>
          <Ionicons name="chevron-down" color={colors.muted} size={18} />
        </Pressable>
        <Text style={[styles.label, { marginBottom: 0, color: colors.muted }]}>
          连接信息
        </Text>
        <Field
          label="配置名称"
          value={draft.name}
          onChangeText={(v) => change("name", v)}
          placeholder="例如：工作模型"
          editable={!busy && !loading}
          maxLength={100}
        />
        {(advanced || draft.provider === "custom") && (
          <Field
            label="API 地址"
            value={draft.baseUrl}
            onChangeText={(v) => change("baseUrl", v)}
            placeholder="https://example.com/v1"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy && !loading}
            keyboardType="url"
            maxLength={500}
          />
        )}
        {draft.provider !== "custom" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="自定义 API 地址"
            onPress={() => setAdvanced((value) => !value)}
            style={[styles.row, { minHeight: 44 }]}
          >
            <Text style={[styles.muted, { flex: 1 }]}>
              API 地址 · {draft.baseUrl || "未填写"}
            </Text>
            <Ionicons
              name={advanced ? "chevron-up" : "create-outline"}
              size={18}
              color={colors.muted}
            />
          </Pressable>
        )}
        <Field
          label="API 密钥"
          value={draft.apiKey}
          onChangeText={(v) => change("apiKey", v)}
          placeholder={id ? "留空保留原密钥" : "请输入完整 API Key"}
          secureTextEntry={!revealKey}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy && !loading}
          maxLength={500}
          accessory={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={revealKey ? "隐藏密钥" : "显示密钥"}
              onPress={() => setRevealKey((v) => !v)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: colors.primary }}>
                {revealKey ? "隐藏" : "显示"}
              </Text>
            </Pressable>
          }
        />
        <Text style={styles.muted}>
          {id ? "密钥留空即可保留原配置。" : "密钥加密保存在题库服务端。"}
        </Text>
        <Text style={[styles.label, { marginBottom: 0, color: colors.muted }]}>
          使用的模型
        </Text>
        <Field
          label="模型名称"
          value={draft.model}
          onChangeText={(v) => change("model", v)}
          placeholder="输入模型 ID，或从列表选择"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy && !loading}
          maxLength={100}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="读取模型列表"
          disabled={loading || busy || !loaded}
          onPress={() => void loadModels()}
          style={[styles.row, { minHeight: 44 }]}
        >
          <Ionicons name="list-outline" size={18} color={colors.primary} />
          <Text style={{ color: colors.primary, fontSize: 14 }}>
            从服务商获取模型列表
          </Text>
        </Pressable>
        <Notice
          message={error}
          retry={!loaded ? () => setRefresh((value) => value + 1) : undefined}
        />
        {busy && <ActivityIndicator color={colors.primary} />}
        <Button
          label="保存并使用"
          icon="checkmark-outline"
          disabled={loading || busy || !loaded}
          onPress={() => void save()}
        />
      </KeyboardAwareScrollView>
      <ModelSheet
        title="选择提供商"
        visible={providerPicker}
        onClose={() => setProviderPicker(false)}
      >
        {modelPresets.map((preset) => (
          <ModelAction
            key={preset.provider}
            label={preset.name}
            selected={draft.provider === preset.provider}
            onPress={() => {
              setDraft((current) => ({
                ...current,
                provider: preset.provider,
                baseUrl: preset.url,
                model: "",
              }));
              setAdvanced(false);
              setProviderPicker(false);
            }}
          />
        ))}
      </ModelSheet>
      <Modal
        visible={picker}
        animationType="slide"
        onRequestClose={() => setPicker(false)}
      >
        <SafeAreaView style={[styles.page, { backgroundColor: colors.white }]}>
          <View style={styles.content}>
            <Text style={styles.heading}>选择模型</Text>
            <Field
              label="搜索模型"
              value={filter}
              onChangeText={setFilter}
              autoCapitalize="none"
            />
            <Button
              label="关闭模型列表"
              secondary
              onPress={() => setPicker(false)}
            />
          </View>
          <FlatList
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: spacing.edge }}
            data={models.filter((model) =>
              model.toLowerCase().includes(filter.toLowerCase()),
            )}
            keyExtractor={(item) => item}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`选择模型 ${item}`}
                onPress={() => {
                  change("model", item);
                  setPicker(false);
                }}
                style={{
                  paddingVertical: spacing.lg,
                  borderBottomWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={styles.body}>{item}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.muted}>没有匹配模型</Text>}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}
