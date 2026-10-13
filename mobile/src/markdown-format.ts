/** Repair inline sequential lists for display without changing source/export text. */
export function formatStudyMarkdown(value: string): string {
  const protectedParts: string[] = [];
  const protectedText = value.replace(
    /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`+[^\n]*?`+)/g,
    (part) => {
      protectedParts.push(part);
      return `\u0000PROTECTED${protectedParts.length - 1}\u0000`;
    },
  );
  const formatted = protectedText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      if (/^(?: {4}|\t)/.test(line)) return line;
      const matches = [
        ...line.matchAll(/(^|[\s:：;；。])(\d{1,2})[.)、](?=\s*[^\d\s])/g),
      ];
      const first = matches.findIndex((match) => Number(match[2]) === 1);
      if (first < 0) return line;
      const sequence = [matches[first]];
      for (const match of matches.slice(first + 1)) {
        if (Number(match[2]) !== sequence.length + 1) break;
        sequence.push(match);
      }
      if (sequence.length < 2) return line;
      let result = line;
      for (const match of sequence.reverse()) {
        const start = match.index! + match[1].length;
        const end = match.index! + match[0].length;
        result =
          result.slice(0, start) +
          (start ? "\n" : "") +
          `${match[2]}. ` +
          result.slice(end).trimStart();
      }
      return result;
    })
    .join("\n");
  return formatted.replace(
    /\u0000PROTECTED(\d+)\u0000/g,
    (_, index: string) => protectedParts[Number(index)],
  );
}
