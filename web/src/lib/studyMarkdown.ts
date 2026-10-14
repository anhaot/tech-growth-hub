import MarkdownIt from 'markdown-it';

/** Keep this contract identical in Web and App; cross-client fixtures verify it. */
export function createStudyMarkdownParser() {
  const parser = new MarkdownIt({ html: false, breaks: true, typographer: false, linkify: false });
  // Technical examples retain literal entities; only explicit HTTP(S) links open.
  parser.disable('entity');
  parser.validateLink = (url: string) => /^https?:\/\//i.test(url);
  return parser;
}

const blockParser = createStudyMarkdownParser();

/** Repair packed numbered answers for display; preserve code, tables and source/export text. */
export function formatStudyMarkdown(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n');
  const protectedLines = new Set<number>();
  for (const token of blockParser.parse(normalized, {})) {
    if (token.map && ['fence', 'code_block', 'table_open'].includes(token.type)) {
      for (let line = token.map[0]; line < token.map[1]; line++) protectedLines.add(line);
    }
  }
  return normalized.split('\n').map((line, index) => {
    if (protectedLines.has(index) || /`|\[[^\]]*\]\(|^\s*(?:>|#{1,6}\s)/.test(line)) return line;
    const matches = [...line.matchAll(/(^|[\s:：;；。])(\d{1,2})[.)、](?=\s*[^\d\s])/g)];
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
      result = result.slice(0, start) + (start ? '\n' : '') + `${match[2]}. ` + result.slice(end).trimStart();
    }
    return result;
  }).join('\n');
}
