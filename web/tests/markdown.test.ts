import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSafeMarkdown, normalizeAIResponse } from '../src/lib/renderMarkdown.ts';
test('paragraphs, hard breaks, fence indentation and inline code survive rendering', () => {
  const html = renderSafeMarkdown('第一行\n第二行\n\n下一段\n\n```c++\n  **literal** <tag>\n\n  last\n```\n\n`**literal** a  b`');
  assert.match(html, /第一行<br>\n第二行/);
  assert.match(html, /<p>下一段<\/p>/);
  assert.match(html, /<code class="language-c\+\+"> {2}\*\*literal\*\* &lt;tag&gt;\n\n {2}last\n<\/code>/);
  assert.match(html, /<code>\*\*literal\*\* a {2}b<\/code>/);
});

test('header-only tables and escaped pipes retain all columns', () => {
  assert.match(renderSafeMarkdown('| A | B |\n| --- | --- |'), /<th>A<\/th>[\s\S]*<th>B<\/th>/);
  assert.match(renderSafeMarkdown('| A | B |\n| --- | --- |\n| `a\\|b` | text |'), /<td><code>a\|b<\/code><\/td>/);
});

test('links and raw HTML are safe, literal entities and command punctuation stay faithful', () => {
  const html = renderSafeMarkdown('<img src=x onerror=alert(1)> &lt;script&gt; [safe](https://example.com/?a=1&b=2) [bad](javascript:alert(2))');
  assert.doesNotMatch(html, /<img|<script|href="javascript:/);
  assert.match(html, /&amp;lt;script&amp;gt;/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
  const technical = '```text\n---\n```';
  assert.equal(normalizeAIResponse(technical), technical);
  assert.equal(normalizeAIResponse('---option 示例'), '---option 示例');
});

test('long technical text reaches the renderer intact', () => {
  const answer = '长内容。'.repeat(3000) + '\n结束标记';
  const html = renderSafeMarkdown(answer);
  assert.ok(html.includes('结束标记'));
  assert.equal((html.match(/长内容。/g) || []).length, 3000);
});
