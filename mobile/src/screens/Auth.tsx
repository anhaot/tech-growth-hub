import React, { useEffect, useRef, useState } from "react";
import { Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ApiClient, normalizeServer } from "../api";
import { useSession } from "../session";
import { storage } from "../storage";
import { Button, Field, Notice, messageOf, styles } from "../components/ui";
import { colors, spacing } from "../theme";

export function AuthScreen() {
  const { session, api, signIn, signOut, authNotice } = useSession();
  const changeRequired = Boolean(session?.user.must_change_password);
  const [server, setServer] = useState(process.env.EXPO_PUBLIC_API_URL || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmationRef = useRef<TextInput>(null);
  useEffect(() => {
    void storage
      .get("server")
      .then((value) => {
        if (value) setServer(value);
      })
      .catch(() => setError("无法读取服务地址，请手动填写"));
  }, []);

  async function submit() {
    if (busy) return;
    setError("");
    if (!password || (!changeRequired && !username.trim())) {
      setError("请输入用户名和密码");
      return;
    }
    if (
      changeRequired &&
      (password.length < 9 ||
        !/[a-zA-Z]/.test(password) ||
        !/[0-9]/.test(password))
    ) {
      setError("新密码至少 9 位，并同时包含字母和数字");
      return;
    }
    if (changeRequired && password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    Keyboard.dismiss();
    setBusy(true);
    try {
      if (changeRequired && api && session) {
        const user = await api.changePassword(password);
        // Changing a password invalidates the old bearer token. Obtain a new one.
        try {
          const result = await new ApiClient(session.server).login(
            user.username,
            password,
          );
          await signIn({ server: session.server, ...result });
        } catch (err) {
          await signOut(
            `密码已更新，自动登录失败：${messageOf(err)}。请使用新密码重新登录。`,
          );
          return;
        }
      } else {
        const address = normalizeServer(server);
        const result = await new ApiClient(address).login(
          username.trim(),
          password,
        );
        await signIn({ server: address, ...result });
      }
      setPassword("");
      setConfirmation("");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <SafeAreaView style={styles.page}>
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        bottomOffset={120}
        extraKeyboardSpace={spacing.xl}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={process.env.EXPO_OS === "web" ? "none" : "on-drag"}
        contentContainerStyle={[
          styles.content,
          {
            flexGrow: 1,
            maxWidth: 480,
            paddingTop: spacing.xxl,
            paddingBottom: spacing.large,
            gap: spacing.xl,
          },
        ]}
      >
        <View style={[styles.row, { gap: spacing.md }]}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              backgroundColor: colors.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="book-outline" size={24} color={colors.white} />
          </View>
          <View>
            <Text style={styles.heading}>技术成长站</Text>
          </View>
        </View>
        <Text style={styles.title}>{changeRequired ? "设置新密码" : "登录"}</Text>
        {changeRequired && <Text style={styles.body}>首次登录，请先设置新密码。</Text>}
        <View style={{ gap: spacing.lg }}>
          <Notice message={error || authNotice} />
          {!changeRequired && (
            <>
              <Field
                label="题库服务地址"
                icon="link-outline"
                value={server}
                onChangeText={setServer}
                placeholder="http://1.1.1.1:18081"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="next"
                submitBehavior="submit"
                editable={!busy}
                onSubmitEditing={() => usernameRef.current?.focus()}
              />
              <Field
                ref={usernameRef}
                label="用户名"
                icon="person-outline"
                value={username}
                onChangeText={setUsername}
                placeholder="输入你的用户名"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                returnKeyType="next"
                submitBehavior="submit"
                editable={!busy}
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            </>
          )}
          <Field
            ref={passwordRef}
            label={changeRequired ? "新密码" : "密码"}
            icon="lock-closed-outline"
            value={password}
            onChangeText={setPassword}
            placeholder={
              changeRequired ? "至少 9 位，包含字母和数字" : "输入你的密码"
            }
            secureTextEntry={!visible}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={changeRequired ? "new-password" : "current-password"}
            editable={!busy}
            returnKeyType={changeRequired ? "next" : "go"}
            submitBehavior="submit"
            onSubmitEditing={() => {
              if (changeRequired) confirmationRef.current?.focus();
              else void submit();
            }}
            accessory={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={visible ? "隐藏密码" : "显示密码"}
                onPress={() => setVisible((value) => !value)}
                hitSlop={8}
                style={{
                  minWidth: 40,
                  minHeight: 44,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name={visible ? "eye-off-outline" : "eye-outline"}
                  size={21}
                  color={colors.muted}
                />
              </Pressable>
            }
          />
          {changeRequired && (
            <Field
              ref={confirmationRef}
              label="确认新密码"
              icon="checkmark-circle-outline"
              value={confirmation}
              onChangeText={setConfirmation}
              secureTextEntry={!visible}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              editable={!busy}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
          )}
          <Button
            label={changeRequired ? "保存并开始背题" : "登录"}
            busy={busy}
            icon="arrow-forward-outline"
            onPress={() => void submit()}
          />
          {changeRequired ? (
            <Button
              label="退出登录"
              disabled={busy}
              secondary
              onPress={() => {
                void signOut().catch((err) => setError(messageOf(err)));
              }}
            />
          ) : (
            <View style={[styles.row, { justifyContent: "center" }]}>
              <Ionicons name="globe-outline" size={15} color={colors.muted} />
              <Text style={styles.muted}>
                支持 HTTP / HTTPS · 与网页共用账号
              </Text>
            </View>
          )}
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
