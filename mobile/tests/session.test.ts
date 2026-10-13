import test from "node:test";
import assert from "node:assert/strict";
import { SessionStorage, storedUser } from "../src/session-storage";
import type { Session } from "../src/types";

const session = (id: string): Session => ({
  server: "https://test.example", token: `token-${id}`,
  user: { id, username: id, email: `${id}@example.com`, role: "user", must_change_password: false,
    user_type: "independent", category_scopes: [], permissions: {} },
});

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => { values.set(key, value); },
    remove: async (key: string) => { values.delete(key); },
  };
  return { values, storage, credentials: new SessionStorage(storage) };
}

test("a login overlapping slow logout retains only the newer account credentials", async () => {
  const f = fixture();
  await f.credentials.save(session("old"));
  let release!: () => void;
  const logout = f.credentials.clear(() => new Promise<void>((resolve) => { release = resolve; }));
  const login = f.credentials.save(session("new"));
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.values.has("token"), false);
  release();
  await Promise.all([logout, login]);
  const credentials = await f.credentials.read();
  assert.equal(credentials.token, "token-new");
  assert.equal(storedUser(credentials.identity, credentials.server!)?.id, "new");
});

test("failed login writes cannot combine an old token with another offline identity and the queue recovers", async (t) => {
  const f = fixture();
  await f.credentials.save(session("old"));
  const write = t.mock.method(f.storage, "set", async (key: string, value: string) => {
    if (key === "identity") throw new Error("storage full");
    f.values.set(key, value);
  });
  await assert.rejects(f.credentials.save(session("new")), /storage full/);
  assert.equal((await f.credentials.read()).token, null);
  write.mock.restore();
  await f.credentials.save(session("new"));
  assert.equal((await f.credentials.read()).token, "token-new");
});

test("an expired restoration cannot overwrite a newer login's cached offline user", async () => {
  const f = fixture();
  await f.credentials.save(session("new"));
  await f.credentials.cacheIdentity(session("old"));
  const value = await f.credentials.read();
  assert.equal(storedUser(value.identity, value.server!)?.id, "new");
  await f.credentials.clear();
  await f.credentials.cacheIdentity(session("old"));
  assert.equal((await f.credentials.read()).identity, null);
});

test("invalid or mismatched offline identities do not restore an account", () => {
  const valid = session("valid");
  assert.equal(storedUser(JSON.stringify({ server: valid.server, user: valid.user }), valid.server)?.id, "valid");
  for (const raw of ["broken JSON", "null", JSON.stringify({ server: valid.server, user: null }),
    JSON.stringify({ server: valid.server, user: { id: "bad", username: null, role: "user" } })])
    assert.equal(storedUser(raw, valid.server), null);
  assert.equal(storedUser(JSON.stringify({ server: valid.server, user: valid.user }), "https://other.example"), null);
});
