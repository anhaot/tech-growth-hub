import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, ActivityIndicator, View } from "react-native";
import { addNetworkStateListener } from "expo-network";
import { useClient, useSession } from "./session";
import { dataStorage } from "./data-storage";
import { StudyRepository } from "./study-repository";
import { permitted } from "./types";
import { Button, Notice, styles } from "./components/ui";
import { colors } from "./theme";

const StudyContext = createContext<StudyRepository | null>(null);
export function StudyProvider({ children }: { children: React.ReactNode }) {
  const { api, user } = useClient();
  const { registerStudyCleanup } = useSession();
  const repository = useMemo(
    () =>
      new StudyRepository(
        api,
        dataStorage,
        user.id,
        permitted(user, "category_view"),
      ),
    [api, user],
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let hydrated = false;
    const unregister = registerStudyCleanup(repository.clearOnLogout);
    setReady(false);
    setError("");
    void repository
      .restore()
      .then(() => {
        if (!active) return;
        hydrated = true;
        setReady(true);
        if (permitted(user, "question_view"))
          void repository.sync({ automatic: true }).catch(() => undefined);
      })
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : "本地题库读取失败");
      });
    const sync = () => {
      if (active && hydrated && permitted(user, "question_view"))
        void repository.sync({ automatic: true }).catch(() => undefined);
    };
    const network = addNetworkStateListener((state) => {
      if (state.isConnected) sync();
    });
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    return () => {
      active = false;
      repository.stop();
      unregister();
      network.remove();
      app.remove();
    };
  }, [repository, user, attempt, registerStudyCleanup]);
  if (!ready)
    return (
      <View style={[styles.page, styles.content]}>
        {error ? (
          <>
            <Notice
              message={error}
              retry={() => setAttempt((value) => value + 1)}
            />
            <Button
              label="重新下载本地题库"
              secondary
              onPress={() => {
                void repository
                  .clear()
                  .then(() => setAttempt((value) => value + 1))
                  .catch((error) => setError(error.message));
              }}
            />
          </>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </View>
    );
  return (
    <StudyContext.Provider value={repository}>{children}</StudyContext.Provider>
  );
}
export function useStudy() {
  const repository = useContext(StudyContext);
  if (!repository) throw new Error("StudyProvider missing");
  const state = useSyncExternalStore(
    repository.subscribe,
    repository.getState,
    repository.getState,
  );
  return { repository, ...state };
}
