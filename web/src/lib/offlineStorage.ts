import { InterviewDraft } from '@/types';

const DB_NAME = 'tech-growth-hub-offline';
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('当前浏览器不支持离线存储'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('interviewDrafts')) {
        const store = database.createObjectStore('interviewDrafts', { keyPath: 'id' });
        store.createIndex('userId', 'userId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('离线数据库打开失败'));
  });
}

async function runRequest<T>(storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    const fail = () => { database.close(); reject(transaction.error || request.error || new Error('离线事务失败')); };
    request.onerror = fail;
    transaction.onabort = fail;
    transaction.onerror = fail;
    transaction.oncomplete = () => { database.close(); resolve(result); };
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
  await runRequest('interviewDrafts', 'readwrite', (store) => store.put({ ...draft, userId }));
}

export async function removeInterviewDrafts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('interviewDrafts', 'readwrite');
    const store = transaction.objectStore('interviewDrafts');
    ids.forEach((id) => store.delete(id));
    transaction.oncomplete = () => { database.close(); resolve(); };
    const fail = () => { database.close(); reject(transaction.error || new Error('删除面试草稿失败')); };
    transaction.onerror = fail; transaction.onabort = fail;
  });
}
