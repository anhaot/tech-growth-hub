import type { Session } from "./types";

interface CredentialStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Serialize account changes so an older logout cannot erase a newer login. */
export class SessionStorage {
  private tasks: Promise<unknown> = Promise.resolve();
  constructor(private storage: CredentialStorage) {}

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tasks.catch(() => undefined).then(operation);
    this.tasks = task;
    return task;
  }

  read() {
    return this.run(async () => {
      const [server, token, identity] = await Promise.all([
        this.storage.get("server"), this.storage.get("token"), this.storage.get("identity"),
      ]);
      return { server, token, identity };
    });
  }

  save(session: Session) {
    return this.run(async () => {
      // Publish the bearer token last: a failed save must never pair an old
      // account's token with another account's cached offline identity.
      await this.storage.remove("token");
      await this.storage.set("server", session.server);
      await this.storage.set("identity", JSON.stringify({ server: session.server, user: session.user }));
      await this.storage.set("token", session.token);
    });
  }

  cacheIdentity(session: Session) {
    return this.run(async () => {
      const [server, token] = await Promise.all([this.storage.get("server"), this.storage.get("token")]);
      if (server === session.server && token === session.token)
        await this.storage.set("identity", JSON.stringify({ server, user: session.user }));
    });
  }

  clear(cleanup?: () => Promise<void>) {
    return this.run(async () => {
      await this.storage.remove("token");
      await this.storage.remove("identity");
      await cleanup?.();
    });
  }
}

export function storedUser(raw: string | null, server: string): Session["user"] | null {
  try {
    const identity: unknown = raw ? JSON.parse(raw) : null;
    if (!identity || typeof identity !== "object" || !("server" in identity) ||
      identity.server !== server || !("user" in identity)) return null;
    const user = identity.user;
    if (!user || typeof user !== "object" || !("id" in user) || typeof user.id !== "string" ||
      !("username" in user) || typeof user.username !== "string" ||
      !("role" in user) || !["admin", "user"].includes(String(user.role))) return null;
    return user as Session["user"];
  } catch { return null; }
}
