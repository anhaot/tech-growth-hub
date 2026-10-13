/** Keep answer text only; reasoning/tool blocks are not a user-facing answer. */
export function answerText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part?.type === "text" && typeof part.text === "string" ? part.text : "",
    )
    .join("");
}
