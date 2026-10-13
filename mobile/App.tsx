import React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppTabBar } from "./src/components/TabBar";
import { SessionProvider, useSession } from "./src/session";
import { StudyProvider } from "./src/study";
import type { RootStackParams } from "./src/types";
import { permitted } from "./src/types";
import { colors } from "./src/theme";
import { Button, Notice, styles } from "./src/components/ui";
import { AuthScreen } from "./src/screens/Auth";
import { HomeScreen } from "./src/screens/Home";
import { LearningScreen } from "./src/screens/Learning";
import { BookmarksScreen } from "./src/screens/Bookmarks";
import { ProfileScreen } from "./src/screens/Profile";
import { ModelEditorScreen } from "./src/screens/ModelEditor";
import { QuestionScreen, StudySessionScreen } from "./src/screens/Reader";
import {
  LibrarySettingsScreen,
  ModelSettingsScreen,
} from "./src/screens/StudySettings";

const Stack = createNativeStackNavigator<RootStackParams>();
const Tabs = createBottomTabNavigator();
const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.white,
    border: colors.border,
    text: colors.text,
  },
};
function AppTabs() {
  const { session } = useSession();
  const canView = session && permitted(session.user, "question_view");
  return (
    <Tabs.Navigator
      detachInactiveScreens={false}
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        lazy: false,
        headerTitleStyle: { fontSize: 20, fontWeight: "700" },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        animation: "none",
      }}
    >
      <Tabs.Screen
        name="首页"
        component={HomeScreen}
        options={{ title: "技术成长站", tabBarLabel: "首页" }}
      />
      {canView && (
        <>
          <Tabs.Screen
            name="学习"
            component={LearningScreen}
            options={{ title: "背题", tabBarLabel: "背题" }}
          />
        </>
      )}
      {canView && <Tabs.Screen name="收藏" component={BookmarksScreen} />}
      <Tabs.Screen name="我的" component={ProfileScreen} />
    </Tabs.Navigator>
  );
}
function Root() {
  const { session, loading, bootError, retry, signOut } = useSession();
  if (loading)
    return (
      <SafeAreaView
        style={[
          styles.page,
          { justifyContent: "center", alignItems: "center", gap: 14 },
        ]}
      >
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.muted}>正在连接你的题库…</Text>
      </SafeAreaView>
    );
  if (bootError)
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.content}>
          <Text style={styles.title}>暂时无法连接</Text>
          <Notice message={bootError} retry={retry} />
          <Button
            label="返回登录 / 更换服务"
            secondary
            onPress={() => {
              void signOut().then(retry).catch(retry);
            }}
          />
        </View>
      </SafeAreaView>
    );
  if (!session || session.user.must_change_password)
    return <AuthScreen key={session ? "password" : "login"} />;
  return (
    <StudyProvider>
      <NavigationContainer theme={theme}>
        <Stack.Navigator
          screenOptions={{
            headerBackTitle: "返回",
            headerTitleStyle: { fontSize: 17 },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen
            name="Tabs"
            component={AppTabs}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Question"
            component={QuestionScreen}
            options={{ title: "题目详情" }}
          />
          <Stack.Screen
            name="Session"
            component={StudySessionScreen}
            options={{ title: "背题复习" }}
          />
          <Stack.Screen
            name="LibrarySettings"
            component={LibrarySettingsScreen}
            options={{ title: "学习题库" }}
          />
          <Stack.Screen
            name="ModelSettings"
            component={ModelSettingsScreen}
            options={{ title: "AI 模型" }}
          />
          <Stack.Screen
            name="ModelEditor"
            component={ModelEditorScreen}
            options={{ title: "模型配置" }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </StudyProvider>
  );
}
export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <SessionProvider>
            <Root />
          </SessionProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
