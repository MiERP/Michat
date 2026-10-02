import type { Api, Model } from "@earendil-works/pi-ai";
import type { StorageNamespace } from "./context";

export type ThinkingLevel = "none" | "low" | "medium" | "high";

export interface ProviderConfig {
  provider: string;
  apiKey: string;
  model: string;
  useProxy: boolean;
  proxyUrl: string;
  thinking: ThinkingLevel;
  followMode: boolean;
  expandToolCalls: boolean;
  apiType?: string;
  customBaseUrl?: string;
  authMethod?: "apikey" | "oauth";
}

function storageKey(ns: StorageNamespace): string {
  return `${ns.localStoragePrefix}-provider-config`;
}

function localBaseUrl(): string {
  return typeof window === "undefined"
    ? "https://localhost:18327/v1"
    : `${window.location.origin}/v1`;
}

export const MICHAT_LOCAL_PROVIDER: ProviderConfig = {
  provider: "custom",
  apiKey: "michat-local",
  model: "michat-local",
  useProxy: false,
  proxyUrl: "",
  thinking: "none",
  followMode: true,
  expandToolCalls: false,
  apiType: "openai-completions",
  customBaseUrl: "https://localhost:18327/v1",
  authMethod: "apikey",
};

export const THINKING_LEVELS: { value: ThinkingLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const API_TYPES = [
  {
    id: "openai-completions",
    name: "OpenAI Completions",
    hint: "MiChat localhost bridge",
  },
];

export function loadSavedConfig(ns: StorageNamespace): ProviderConfig {
  let preferences: Partial<ProviderConfig> = {};
  try {
    const saved = localStorage.getItem(storageKey(ns));
    if (saved) preferences = JSON.parse(saved) as Partial<ProviderConfig>;
  } catch {}

  return {
    ...MICHAT_LOCAL_PROVIDER,
    customBaseUrl: localBaseUrl(),
    thinking: preferences.thinking ?? MICHAT_LOCAL_PROVIDER.thinking,
    followMode: preferences.followMode ?? MICHAT_LOCAL_PROVIDER.followMode,
    expandToolCalls:
      preferences.expandToolCalls ?? MICHAT_LOCAL_PROVIDER.expandToolCalls,
  };
}

export function saveConfig(ns: StorageNamespace, config: ProviderConfig) {
  const localConfig: ProviderConfig = {
    ...MICHAT_LOCAL_PROVIDER,
    customBaseUrl: localBaseUrl(),
    thinking: config.thinking,
    followMode: config.followMode,
    expandToolCalls: config.expandToolCalls,
  };
  localStorage.setItem(storageKey(ns), JSON.stringify(localConfig));
}

export function buildCustomModel(config: ProviderConfig): Model<Api> | null {
  if (!config.apiType || !config.customBaseUrl || !config.model) return null;
  return {
    id: config.model,
    name: "MiChat local model",
    api: config.apiType as Api,
    provider: "custom",
    baseUrl: config.customBaseUrl,
    reasoning: false,
    input: ["text", "image"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
}

export function applyProxyToModel(
  model: Model<Api>,
  _config: ProviderConfig,
): Model<Api> {
  return model;
}
