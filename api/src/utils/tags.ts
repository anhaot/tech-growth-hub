export type TagAliasMap = Record<string, string>;
export const MAX_QUESTION_TAGS = 5;

export function normalizeTagName(tag: string): string {
  return String(tag || '')
    .replace(/[，、；;]/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function parseTagAliasMap(rawValue: string | null | undefined): TagAliasMap {
  if (!rawValue || !rawValue.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const aliases: TagAliasMap = Object.create(null);
    for (const [alias, target] of Object.entries(parsed)) {
      const normalizedAlias = normalizeTagName(alias);
      const normalizedTarget = normalizeTagName(String(target || ''));
      if (!normalizedAlias || !normalizedTarget || normalizedAlias === normalizedTarget) {
        continue;
      }
      aliases[normalizedAlias] = normalizedTarget;
    }

    return aliases;
  } catch {
    return {};
  }
}

export function resolveTagAlias(tag: string, aliases: TagAliasMap = {}): string {
  let current = normalizeTagName(tag);
  const visited = new Set<string>();

  while (Object.hasOwn(aliases, current) && aliases[current] && !visited.has(current)) {
    visited.add(current);
    current = normalizeTagName(aliases[current]);
  }

  return current;
}

export function normalizeTagsInput(tags: unknown, aliases: TagAliasMap = {}): string[] {
  const values = Array.isArray(tags)
    ? tags
    : typeof tags === 'string'
      ? tags.split(/[，,、；;]/)
      : [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = resolveTagAlias(String(value || ''), aliases);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= MAX_QUESTION_TAGS) {
      break;
    }
  }

  return result;
}

export function parseStoredTags(rawTags: string | null | undefined, aliases: TagAliasMap = {}): string[] {
  if (!rawTags || !rawTags.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawTags);
    return normalizeTagsInput(parsed, aliases);
  } catch {
    return normalizeTagsInput(rawTags, aliases);
  }
}
