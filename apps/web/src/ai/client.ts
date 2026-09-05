import Anthropic from '@anthropic-ai/sdk';
import type { AiConfig } from './config.js';

/** 浏览器端直连：密钥只存在用户本机，调用由用户自己的账号计费。 */
export function createClient(cfg: AiConfig): Anthropic {
  return new Anthropic({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl.trim() || undefined, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

/** 把 SDK 错误转成用户可读的中文。 */
export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'API Key 无效或没有权限';
  if (e instanceof Anthropic.RateLimitError) return '请求过于频繁，稍后再试';
  if (e instanceof Anthropic.BadRequestError) return `请求参数错误：${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return '无法连接到模型服务（网络或 CORS 问题）';
  if (e instanceof Anthropic.APIError) return `模型服务错误 ${e.status ?? ''}：${e.message}`;
  return (e as Error).message ?? String(e);
}
