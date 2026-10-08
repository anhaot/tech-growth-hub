import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type { Question } from '../types/index.js';

export interface SimilarPair { left: Question; right: Question; titleScore: number; contentScore: number; score: number }
export interface DuplicateGroup { title: string; count: number; questions: Question[] }
export const MAX_DUPLICATE_PAIRS = 10000;
const normalize = (value: string) => String(value || '').toLowerCase().replace(/[`~!@#$%^&*()_=+[\]{}\\|;:'",.<>/?，。！？；：“”‘’、（）【】《》\s-]/g, '');
function tokens(value: string): Set<string> {
  const text = normalize(value);
  if (text.length < 2) return new Set(text ? [text] : []);
  return new Set(Array.from({ length: text.length - 1 }, (_, i) => text.slice(i, i + 2)));
}
function dice(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let count = 0;
  for (const token of left) if (right.has(token)) count++;
  return 2 * count / (left.size + right.size);
}

// Keep the highest scoring results without storing every matching pair.
class PairHeap {
  values: SimilarPair[] = [];
  add(pair: SimilarPair): void {
    if (this.values.length === MAX_DUPLICATE_PAIRS) {
      if (pair.score <= this.values[0].score) return;
      this.values[0] = pair;
      let i = 0;
      while (i * 2 + 1 < this.values.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.values.length && this.values[child + 1].score < this.values[child].score) child++;
        if (this.values[i].score <= this.values[child].score) break;
        [this.values[i], this.values[child]] = [this.values[child], this.values[i]];
        i = child;
      }
    } else {
      this.values.push(pair);
      let i = this.values.length - 1;
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2);
        if (this.values[parent].score <= pair.score) break;
        this.values[i] = this.values[parent]; i = parent;
      }
      this.values[i] = pair;
    }
  }
}

export async function scanDuplicates(questions: Question[], progress: (processed: number) => void = () => {}) {
  const groups = new Map<string, Question[]>();
  const identical = new Map<string, Question[]>();
  for (const question of questions) {
    const key = question.title.trim().toLowerCase();
    const group = groups.get(key) || []; group.push(question); groups.set(key, group);
    const signature = JSON.stringify([normalize(question.title), normalize(question.content)]);
    const same = identical.get(signature) || []; same.push(question); identical.set(signature, same);
  }
  const entries = [...identical.values()].map((items) => ({ items, title: tokens(items[0].title), content: tokens(items[0].content) }));
  const heap = new PairHeap();
  let total = 0;
  const record = (left: Question[], right: Question[], titleScore: number, contentScore: number, internal = false) => {
    total += internal ? left.length * (left.length - 1) / 2 : left.length * right.length;
    const score = Math.max(titleScore, contentScore);
    if (heap.values.length === MAX_DUPLICATE_PAIRS && score <= heap.values[0].score) return;
    let emitted = 0;
    for (let a = 0; a < left.length; a++) {
      for (let b = internal ? a + 1 : 0; b < right.length; b++) {
        heap.add({ left: left[a], right: right[b], titleScore, contentScore, score });
        if (++emitted >= MAX_DUPLICATE_PAIRS) return;
      }
    }
  };
  for (const entry of entries) if (entry.items.length > 1 && (entry.title.size || entry.content.size)) {
    record(entry.items, entry.items, entry.title.size ? 1 : 0, entry.content.size ? 1 : 0, true);
  }
  // Dice >= t implies Jaccard >= t/(2-t). Globally ordered prefixes provide
  // lossless candidates; calculate each title/content token set just once.
  const frequencies = { title: new Map<string, number>(), content: new Map<string, number>() };
  for (const entry of entries) for (const field of ['title', 'content'] as const) {
    for (const token of entry[field]) frequencies[field].set(token, (frequencies[field].get(token) || 0) + 1);
  }
  const indexes = { title: new Map<string, number[]>(), content: new Map<string, number[]>() };
  let processed = 0;
  let comparisons = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const candidates = new Set<number>();
    for (const field of ['title', 'content'] as const) {
      const threshold = field === 'title' ? 0.86 : 0.72;
      const jaccard = threshold / (2 - threshold);
      const sorted = [...entry[field]].sort((a, b) => frequencies[field].get(a)! - frequencies[field].get(b)! || (a < b ? -1 : a > b ? 1 : 0));
      const prefix = sorted.slice(0, sorted.length - Math.ceil(jaccard * sorted.length) + 1);
      for (const token of prefix) {
        const posting = indexes[field].get(token) || [];
        for (const other of posting) {
          const otherSize = entries[other][field].size;
          if (2 * Math.min(otherSize, sorted.length) / (otherSize + sorted.length) >= threshold) candidates.add(other);
        }
        posting.push(i); indexes[field].set(token, posting);
      }
    }
    for (const j of candidates) {
      const titleScore = dice(entry.title, entries[j].title);
      const contentScore = dice(entry.content, entries[j].content);
      if (titleScore >= 0.86 || contentScore >= 0.72) record(entries[j].items, entry.items, titleScore, contentScore);
      if (++comparisons % 2000 === 0) await yieldToLoop();
    }
    processed += entry.items.length;
    progress(processed);
    if (i % 50 === 0) await yieldToLoop();
  }
  return {
    total, pairs: heap.values.sort((a, b) => b.score - a.score || a.left.id.localeCompare(b.left.id) || a.right.id.localeCompare(b.right.id)),
    groups: [...groups.values()].filter((group) => group.length > 1).map((group) => ({ title: group[0].title, count: group.length, questions: group })),
    scanned: questions.length, comparisons, truncated: total > MAX_DUPLICATE_PAIRS,
  };
}
