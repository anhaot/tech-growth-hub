import { createStudyMarkdownParser, formatStudyMarkdown } from './studyMarkdown.ts';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function normalizeAIResponse(text: string): string {
  if (!text) {
    return '';
  }

  let normalized = text.trim();

  normalized = normalized.replace(
    /^(好的[，,。！!\s]*|当然可以[，,。！!\s]*|可以[，,。！!\s]*|没问题[，,。！!\s]*|下面是[：:，,\s]*|以下是[：:，,\s]*)(关于|针对|基于|围绕)?/i,
    (_match, _prefix, contextPrefix = '') => contextPrefix || ''
  );

  normalized = normalized.replace(
    /^(以下是关于.*?(结构化回答|详细说明|回答|分析).*?(?:。|：|:)\s*)/i,
    ''
  );

  normalized = normalized.replace(
    /^(好的[，,。！!\s]*当然可以[，,。！!\s]*|好的[，,。！!\s]*|当然可以[，,。！!\s]*)/i,
    ''
  );

  normalized = normalized.replace(/^(?:-{3,}|\*{3,})[ \t]*(?:\r?\n|$)/, '');

  return normalized.trim();
}

const studyParser = createStudyMarkdownParser();
const renderTableOpen = studyParser.renderer.rules.table_open;
const renderTableClose = studyParser.renderer.rules.table_close;
studyParser.renderer.rules.table_open = (tokens, index, options, env, renderer) =>
  '<div class="markdown-table">' + (renderTableOpen ? renderTableOpen(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options));
studyParser.renderer.rules.table_close = (tokens, index, options, env, renderer) =>
  (renderTableClose ? renderTableClose(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options)) + '</div>';
const renderLinkOpen = studyParser.renderer.rules.link_open;
studyParser.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return renderLinkOpen ? renderLinkOpen(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options);
};

export function renderSafeMarkdown(text: string, variant: 'compact' | 'rich' = 'rich'): string {
  if (!text) return '';
  return `<div class="markdown-${variant}">${studyParser.render(formatStudyMarkdown(text))}</div>`;
}

export function renderMultilineText(text: string): string {
  if (!text) {
    return '';
  }

  return escapeHtml(text).replace(/\n/g, '<br/>');
}
