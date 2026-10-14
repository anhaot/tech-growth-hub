import test from "node:test";
import assert from "node:assert/strict";
import { formatStudyMarkdown } from "../src/markdown-format";
import { modelConfigInput } from "../src/model-config";

test("inline sequential Chinese lists become separate rows without changing versions or code", () => {
  const formatted = formatStudyMarkdown(
    "主要能力：1. 观察流量；2. 安全策略；3. DNS 分析。\n版本 1.2.3，IP 192.0.2.10\n`1. foo 2. bar`\n```bash\necho '1. foo 2. bar'\n```",
  );
  assert.match(formatted, /\n1\. 观察流量；\n2\. 安全策略；\n3\. DNS 分析/);
  assert.match(formatted, /版本 1\.2\.3，IP 192\.0\.2\.10/);
  assert.match(formatted, /`1\. foo 2\. bar`/);
  assert.match(formatted, /echo '1\. foo 2\. bar'/);
  const long =
    "1. 已分行\n2. 保持原格式\n\n" + "完整长回答。".repeat(3000) + "最后一段";
  assert.equal(formatStudyMarkdown(long), long);
});
test("model editing omits blank keys, creation requires a key and invalid API URLs are rejected", () => {
  const draft = {
    provider: "openai",
    name: "工作模型",
    baseUrl: "https://api.openai.com/v1/",
    apiKey: "",
    model: "test-model",
  };
  const edit = modelConfigInput(draft, true);
  assert.equal(Object.hasOwn(edit, "apiKey"), false);
  assert.equal(edit.isCustom, false);
  assert.throws(() => modelConfigInput(draft, false), /密钥/);
  assert.equal(
    modelConfigInput(
      {
        ...draft,
        provider: "nvidia",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        apiKey: "new-key",
      },
      false,
    ).isCustom,
    true,
  );
  for (const baseUrl of [
    "http://example.com/v1",
    "https://user:secret@example.com/v1",
    "https://example.com/v1?key=secret",
  ])
    assert.throws(() => modelConfigInput({ ...draft, baseUrl }, true), /HTTPS/);
});

test("technical answers retain ASCII command quotes and option punctuation", async () => {
  const { studyMarkdownParser } = await import("../src/study-markdown-parser");
  const source = 'ENTRYPOINT 是 ["echo", "hello"]，CMD 是 ["world"]；参数 "test"、\'arg\' 和 --option...。';
  const tokens = studyMarkdownParser.parse(formatStudyMarkdown(source), {});
  const rendered = tokens.flatMap((token) => token.children || [])
    .filter((token) => token.type === "text").map((token) => token.content).join("");
  assert.equal(rendered, source);
});

test("formatting preserves nested and unclosed fences, indented code, tables and literal markers", async () => {
  const { studyMarkdownParser } = await import("../src/study-markdown-parser");
  const samples = [
    "````text\n```\n1. code 2. remains\n````",
    "```c++\n  1. code 2. remains\n",
    "    1. code 2. remains\n",
    "| A | B |\n| --- | --- |\n| 1. first 2. second | value |",
    "\u0000PROTECTED0\u0000 与 `真实代码`",
    "> 1. first 2. second",
  ];
  for (const source of samples) assert.equal(formatStudyMarkdown(source), source);
  const table = studyMarkdownParser.parse(samples[3], {});
  assert.ok(table.some(token => token.type === "table_open"));
  const fence = studyMarkdownParser.parse(samples[0], {}).find(token => token.type === "fence");
  assert.equal(fence?.content, "```\n1. code 2. remains\n");
});
