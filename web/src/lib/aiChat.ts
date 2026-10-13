interface ChatMessage { role: string; content: string }
const MAX_CHAT_LENGTH = 12000;

export function buildChatMessage(history: ChatMessage[], message: string): string {
  const current = message.trim();
  if (history.length === 0) return current;
  const prefix = '请结合以下对话上下文回答最后一个用户问题。\n\n';
  const suffix = `\n\n用户：${current}`;
  let remaining = MAX_CHAT_LENGTH - prefix.length - suffix.length;
  if (remaining <= 0) return current;
  const turns: string[] = [];
  for (const turn of history.slice(-8).reverse()) {
    const text = `${turn.role === 'assistant' ? '助手' : '用户'}：${turn.content}`;
    const limit = Math.min(3000, remaining - 2);
    if (limit < 10) break;
    const bounded = text.length > limit ? `${text.slice(0, limit - 7)}（后文省略）` : text;
    turns.unshift(bounded);
    remaining -= bounded.length + 2;
  }
  return turns.length ? `${prefix}${turns.join('\n\n')}${suffix}` : current;
}
