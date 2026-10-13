export interface AIReply {
  id: string;
  questionId: string;
  questionTitle: string;
  prompt: string;
  content: string;
  provider: string;
  createdAt: string;
  truncated?: boolean;
}

const heading = (value: string) => value.replace(/[\r\n]+/g, " ").trim();
/** Preserve model Markdown verbatim, including code fences, tables and Unicode. */
export function repliesToMarkdown(replies: readonly AIReply[]): string {
  if (!replies.length) throw new Error("请选择至少一条答疑记录");
  return (
    "# 技术成长站 · AI 答疑\n\n" +
    replies
      .map(
        (reply, index) =>
          `## ${index + 1}. ${heading(reply.questionTitle)}\n\n` +
          `时间：${reply.createdAt}\n\n模型：${heading(reply.provider || "服务默认模型")}\n\n` +
          `### 提问\n\n${reply.prompt}\n\n### AI 回复\n\n${reply.content}\n` +
          (reply.truncated
            ? "\n> 该回复尚未完成，可在 App 中继续补全。\n"
            : ""),
      )
      .join("\n---\n\n")
  );
}
export function exportFilename(
  replies: readonly AIReply[],
  now = new Date(),
): string {
  const title =
    replies.length === 1
      ? replies[0].questionTitle
      : `批量-${replies.length}条`;
  const safe =
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 48) || "答疑";
  return `AI答疑-${safe}-${now.toISOString().replace(/[:.]/g, "-")}.md`;
}
