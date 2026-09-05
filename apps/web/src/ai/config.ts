import { create } from 'zustand';

export interface AiConfig { baseUrl: string; apiKey: string; model: string; effort: 'low' | 'medium' | 'high' }
const KEY = 'tracelet:ai-config';
export const DEFAULT_AI: AiConfig = { baseUrl: '', apiKey: '', model: 'claude-opus-5', effort: 'medium' };

function load(): AiConfig {
  try { const raw = localStorage.getItem(KEY) ?? localStorage.getItem('eda:ai-config'); if (raw) return { ...DEFAULT_AI, ...(JSON.parse(raw) as Partial<AiConfig>) }; } catch { /* ignore */ }
  return { ...DEFAULT_AI };
}

interface AiConfigState { cfg: AiConfig; set: (p: Partial<AiConfig>) => void; save: () => void }
/** AI 配置（只存本机浏览器；开源版允许接任何兼容端点）。 */
export const useAiConfig = create<AiConfigState>((set, get) => ({
  cfg: load(),
  set: (p) => set({ cfg: { ...get().cfg, ...p } }),
  save: () => { try { localStorage.setItem(KEY, JSON.stringify(get().cfg)); } catch { /* ignore */ } }
}));
export const isAiConfigured = (cfg: AiConfig) => cfg.apiKey.trim().length > 0;
