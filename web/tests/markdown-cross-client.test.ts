import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSafeMarkdown, normalizeAIResponse } from '../src/lib/renderMarkdown.ts';
import { createStudyMarkdownParser, formatStudyMarkdown } from '../src/lib/studyMarkdown.ts';
import { createStudyMarkdownParser as appParser, formatStudyMarkdown as appFormat } from '../../mobile/src/markdown-format.ts';

const fixtures = JSON.parse(readFileSync(new URL('../../fixtures/study-markdown.json', import.meta.url), 'utf8'));
for (const fixture of fixtures) {
  test(`Web and App share Markdown structure: ${fixture.name}`, () => {
    const formatted = formatStudyMarkdown(fixture.source);
    assert.equal(formatted, appFormat(fixture.source));
    const web = createStudyMarkdownParser().parse(formatted, {});
    const app = appParser().parse(formatted, {});
    const structure = (tokens: typeof web): unknown => tokens.map(token => ({
      type: token.type, tag: token.tag, nesting: token.nesting, content: token.content,
      attrs: token.attrs, info: token.info, children: token.children ? structure(token.children) : undefined,
    }));
    assert.deepEqual(structure(web), structure(app));
    const types = JSON.stringify(structure(web));
    for (const type of fixture.types) assert.ok(types.includes(`"type":"${type}"`), type);
    for (const variant of ['rich', 'compact'] as const) {
      const html = renderSafeMarkdown(fixture.source, variant);
      assert.doesNotMatch(html, /<(?:script|svg|iframe)\b|href="(?:javascript|data|file):/i);
    }
  });
}

