import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiClient, ApiError } from "./api";
import { storage } from "./storage";
import { isConnected } from "./network";
import { dataStorage } from "./data-storage";
import { SessionStorage, storedUser } from "./session-storage";
import type { Session } from "./types";

interface SessionContextValue {
  session: Session | null;
  api: ApiClient | null;
  loading: boolean;
  bootError: string;
  authNotice: string;
  retry: () => void;
  signIn: (session: Session) => Promise<void>;
  signOut: (notice?: string) => Promise<void>;
  registerStudyCleanup: (cleanup: () => Promise<void>) => () => void;
}
const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const revision = useRef(0);
  const activeToken = useRef<string | null>(null);
  const credentials = useRef(new SessionStorage(storage));
  const logoutTask = useRef<Promise<void> | null>(null);
  const studyCleanup = useRef<(() => Promise<void>) | null>(null);
  const registerStudyCleanup = useCallback((cleanup: () => Promise<void>) => {
    studyCleanup.current = cleanup;
    return () => {
      if (studyCleanup.current === cleanup) studyCleanup.current = null;
    };
  }, []);

  const restore = useCallback(async () => {
    const current = ++revision.current;
    setLoading(true);
    setBootError("");
    try {
      const { server, token, identity } = await credentials.current.read();
      if (current !== revision.current) return;
      if (server && token) {
        let user: Session["user"];
        try {
          user = await new ApiClient(
            server,
            token,
            undefined,
            isConnected,
          ).me();
          await credentials.current.cacheIdentity({ server, token, user });
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 0) throw error;
          const cached = storedUser(identity, server);
          if (!cached) throw error;
          user = cached;
        }
        if (current === revision.current) {
          activeToken.current = token;
          setSession({ server, token, user });
        }
      } else if (current === revision.current) {
        activeToken.current = null;
        setSession(null);
      }
    } catch (error) {
      if (current !== revision.current) return;
      if (error instanceof ApiError && error.status === 401) {
        try {
          await credentials.current.clear();
          if (current === revision.current) {
            activeToken.current = null;
            setSession(null);
            setAuthNotice("登录已失效，请重新登录");
          }
        } catch {
          if (current === revision.current)
            setBootError("无法清除失效登录信息，请重试");
        }
      } else
        setBootError(
          error instanceof Error ? error.message : "无法读取登录信息",
        );
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void restore();
  }, [restore]);

  const signIn = useCallback(async (value: Session) => {
    const current = ++revision.current;
    activeToken.current = null;
    await credentials.current.save(value);
    if (current !== revision.current) return;
    activeToken.current = value.token;
    setBootError("");
    setAuthNotice("");
    setSession(value);
  }, []);
  const signOut = useCallback(
    (notice = "") => {
      if (logoutTask.current) return logoutTask.current;
      const current = ++revision.current;
      activeToken.current = null;
      const cleanup = studyCleanup.current;
      const task = credentials.current.clear(async () => {
        await cleanup?.();
        // Password-change screens do not mount StudyProvider, so still clear
        // any mirror left by this account before completing the logout.
        if (session) await dataStorage.remove(
          `tgh.study.v1.${encodeURIComponent(session.server)}.${encodeURIComponent(session.user.id)}`,
        );
      }).catch((error) => {
        if (current === revision.current) setBootError("无法清除登录信息，请重试");
        throw error;
      }).finally(() => {
        if (current === revision.current) {
          setSession(null);
          setAuthNotice(notice);
        }
        if (logoutTask.current === task) logoutTask.current = null;
      });
      logoutTask.current = task;
      return task;
    },
    [session],
  );
  const api = useMemo(
    () =>
      session
        ? new ApiClient(
            session.server,
            session.token,
            (status) => {
              // An old in-flight request must not invalidate a newer login.
              if (activeToken.current !== session.token) return;
              if (status === 401) {
                void signOut("登录已失效，请重新登录").catch(() => undefined);
              } else if (status === 428) {
                setSession((current) =>
                  current?.token === session.token
                    ? {
                        ...current,
                        user: { ...current.user, must_change_password: true },
                      }
                    : current,
                );
              }
            },
            isConnected,
          )
        : null,
    [session, signOut],
  );
  return (
    <SessionContext.Provider
      value={{
        session,
        api,
        loading,
        bootError,
        authNotice,
        retry: restore,
        signIn,
        signOut,
        registerStudyCleanup,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider missing");
  return value;
}
export function useClient() {
  const { api, session } = useSession();
  if (!api || !session) throw new Error("Not signed in");
  return { api, user: session.user, server: session.server };
}
