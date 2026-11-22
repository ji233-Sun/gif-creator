import { z } from 'zod';

export const providers = {
  chatgpt: { label: 'ChatGPT 订阅 · Responses', model: 'gpt-5.4', baseUrl: 'https://api.openai.com/v1', protocol: 'responses' },
  'openai-responses': { label: 'OpenAI · Responses', model: 'gpt-5-mini', baseUrl: 'https://api.openai.com/v1', protocol: 'responses' },
  'openai-chat': { label: 'OpenAI 兼容 · Chat Completions', model: 'gpt-5-mini', baseUrl: 'https://api.openai.com/v1', protocol: 'chat' },
  anthropic: { label: 'Anthropic 兼容 · Messages', model: 'claude-sonnet-4-6', baseUrl: 'https://api.anthropic.com/v1', protocol: 'messages' },
  gemini: { label: 'Google Gemini 兼容 · Generate Content', model: 'gemini-2.5-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', protocol: 'gemini' },
  deepseek: { label: 'DeepSeek · Chat Completions', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', protocol: 'chat' },
  gateway: { label: 'Vercel AI Gateway · Chat Completions', model: 'openai/gpt-5-mini', baseUrl: 'https://ai-gateway.vercel.sh/v1', protocol: 'chat' },
} as const;

export const providerSchema = z.enum(Object.keys(providers) as (keyof typeof providers)[]);
export const modelSchema = z.string().trim().min(1).max(180).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
export const keySchema = z.string().trim().min(1).max(1024).regex(/^[!-~]+$/);
export const baseUrlSchema = z.string().trim().max(1024).pipe(z.url()).transform(value => new URL(value))
  .refine(url => url.protocol === 'https:' && !url.username && !url.password && !url.href.includes('?') && !url.href.includes('#'))
  .transform(url => url.href.replace(/\/+$/, ''));
export type DirectorProvider = z.infer<typeof providerSchema>;
export type DirectorProtocol = typeof providers[DirectorProvider]['protocol'];
export type DirectorSettings = { provider: DirectorProvider; model: string; key: string; baseUrl?: string };
export const directorProviderHeader = 'x-paji-ai-provider';
export const directorModelHeader = 'x-paji-ai-model';
export const directorBaseUrlHeader = 'x-paji-ai-base-url';