export interface ProviderConfiguration {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  hasCredential: boolean;
}

export interface ProviderConnectionResult {
  ok: boolean;
  latencyMs?: number;
  message: string;
}

export interface OnlineAsrProvider {
  readonly kind: "online-asr";
  testConnection(configuration: ProviderConfiguration): Promise<ProviderConnectionResult>;
}

export interface AiProvider {
  readonly kind: "generative-ai";
  testConnection(configuration: ProviderConfiguration): Promise<ProviderConnectionResult>;
}
