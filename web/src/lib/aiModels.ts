import { AIModelOption, AIStatus } from '@/types';

export function getAvailableAIModels(status: AIStatus): AIModelOption[] {
  return status.availableModels?.length ? status.availableModels : status.availableProviders.map((name) => ({
    id: name,
    label: name,
    provider: name,
    model: '',
    isActive: name === status.defaultProvider,
  }));
}

export function resolveAIModel(status: AIStatus, current: string): string {
  const models = getAvailableAIModels(status);
  const match = models.find((model) => model.id === current)
    || models.find((model) => model.label === current)
    || models.find((model) => model.isActive && model.provider === current)
    || models.find((model) => model.provider === current);
  return match?.id || status.defaultConfigId || models.find((model) => model.isActive)?.id
    || models[0]?.id || status.defaultProvider;
}

export function getPreferredAIModel(): string {
  try { return localStorage.getItem('ai_provider') || ''; } catch { return ''; }
}

export function savePreferredAIModel(provider: string): void {
  try { if (provider) localStorage.setItem('ai_provider', provider); } catch { /* Preferences are optional. */ }
}
