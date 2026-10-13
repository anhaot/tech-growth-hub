import type { AIConfigInput } from "./types";

export const modelPresets = [
  { provider: "openai", name: "OpenAI", url: "https://api.openai.com/v1" },
  {
    provider: "deepseek",
    name: "DeepSeek",
    url: "https://api.deepseek.com/v1",
  },
  {
    provider: "qwen",
    name: "通义千问",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  {
    provider: "nvidia",
    name: "NVIDIA",
    url: "https://integrate.api.nvidia.com/v1",
  },
  { provider: "custom", name: "自定义", url: "" },
];
export function modelConfigInput(
  draft: {
    provider: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
  },
  editing: boolean,
): AIConfigInput {
  const baseUrl = draft.baseUrl.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("请输入完整的 HTTPS API 地址");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("API 地址需使用 HTTPS，且不能包含密钥、查询参数或账号");
  const model = draft.model.trim();
  if (!model) throw new Error("请输入或选择模型名称");
  const apiKey = draft.apiKey.trim();
  if (!editing && !apiKey) throw new Error("请输入 API 密钥");
  const builtin = modelPresets.find(
    (preset) =>
      preset.provider === draft.provider &&
      preset.url === baseUrl &&
      preset.provider !== "nvidia",
  );
  return {
    provider: draft.provider,
    displayName: draft.name.trim(),
    baseUrl,
    model,
    isCustom: !builtin,
    ...(apiKey ? { apiKey } : {}),
  };
}
