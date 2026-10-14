import { InterviewDraft } from '@/types';

const DB_NAME = 'tech-growth-hub-offline';
const DB_VERSION = 2;
let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('当前浏览器不支持离线存储'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const fail = (error: Error | DOMException) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(error);
    };
    const timer = window.setTimeout(() => fail(new Error('离线数据库打开超时，请关闭其他页面后重试')), 15000);
    request.onblocked = () => fail(new Error('离线数据库升级被其他页面占用，请关闭其他页面后重试'));
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return; }
      const database = request.result;
      const createStore = () => {
        const store = database.createObjectStore('interviewDrafts', { keyPath: ['userId', 'id'] });
        store.createIndex('userId', 'userId', { unique: false });
        return store;
      };
      if (!database.objectStoreNames.contains('interviewDrafts')) {
        createStore();
      } else if (request.transaction) {
        const existing = request.transaction.objectStore('interviewDrafts');
        if (existing.keyPath === 'id') {
          const records = existing.getAll();
          records.onsuccess = () => {
            database.deleteObjectStore('interviewDrafts');
            const store = createStore();
            records.result.forEach((draft) => store.put(draft));
          };
        }
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) { database.close(); return; }
      settled = true;
      window.clearTimeout(timer);
      const invalidate = () => { if (databasePromise === opening) databasePromise = null; };
      database.onversionchange = () => { database.close(); invalidate(); };
      database.onclose = invalidate;
      resolve(database);
    };
    request.onerror = () => fail(request.error || new Error('离线数据库打开失败'));
  });
  databasePromise = opening;
  void opening.catch(() => { if (databasePromise === opening) databasePromise = null; });
  return opening;
}

export async function getInterviewDrafts(userId: string): Promise<InterviewDraft[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('interviewDrafts', 'readonly');
    const request = transaction.objectStore('interviewDrafts').index('userId').getAll(userId);
    transaction.oncomplete = () => { resolve(
      request.result
        .map(({ userId: _userId, ...draft }) => draft as InterviewDraft)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    ); };
    const fail = () => { reject(transaction.error || request.error || new Error('读取面试草稿失败')); };
    request.onerror = fail; transaction.onerror = fail; transaction.onabort = fail;
  });
}

export async function saveInterviewDraft(userId: string, draft: InterviewDraft): Promise<void> {
  await saveInterviewDrafts(userId, [draft]);
}

export async function saveInterviewDrafts(userId: string, drafts: InterviewDraft[]): Promise<void> {
  if (drafts.length === 0) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('interviewDrafts', 'readwrite');
    const store = transaction.objectStore('interviewDrafts');
    drafts.forEach((draft) => store.put({ ...draft, userId }));
    transaction.oncomplete = () => { resolve(); };
    const fail = () => { reject(transaction.error || new Error('保存面试草稿失败')); };
    transaction.onerror = fail; transaction.onabort = fail;
  });
}

export async function removeInterviewDrafts(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('interviewDrafts', 'readwrite');
    const store = transaction.objectStore('interviewDrafts');
    ids.forEach((id) => store.delete([userId, id]));
    transaction.oncomplete = () => { resolve(); };
    const fail = () => { reject(transaction.error || new Error('删除面试草稿失败')); };
    transaction.onerror = fail; transaction.onabort = fail;
  });
}
