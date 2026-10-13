import { InterviewDraft } from '@/types';

const DB_NAME = 'tech-growth-hub-offline';
const DB_VERSION = 2;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('当前浏览器不支持离线存储'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
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
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error('离线数据库打开失败'));
  });
}

export async function getInterviewDrafts(userId: string): Promise<InterviewDraft[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('interviewDrafts', 'readonly');
    const request = transaction.objectStore('interviewDrafts').index('userId').getAll(userId);
    transaction.oncomplete = () => { database.close(); resolve(
      request.result
        .map(({ userId: _userId, ...draft }) => draft as InterviewDraft)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    ); };
    const fail = () => { database.close(); reject(transaction.error || request.error || new Error('读取面试草稿失败')); };
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
    transaction.oncomplete = () => { database.close(); resolve(); };
    const fail = () => { database.close(); reject(transaction.error || new Error('保存面试草稿失败')); };
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
    transaction.oncomplete = () => { database.close(); resolve(); };
    const fail = () => { database.close(); reject(transaction.error || new Error('删除面试草稿失败')); };
    transaction.onerror = fail; transaction.onabort = fail;
  });
}
