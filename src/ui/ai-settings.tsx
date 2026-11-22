"use client";

import { useEffect, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@ui-sdk/react/dialog";
import { Settings, X } from "lucide-react";
import { baseUrlSchema, keySchema, modelSchema, providers, type DirectorProvider, type DirectorSettings } from "@/director/settings";

type ChatGptStatus = { state: 'disconnected' | 'waiting' | 'connected' | 'error'; message?: string; model?: string };
const connectionUrl = '/api/llm/chatgpt';

export function AiSettings({ value, disabled, onChange }: { value: DirectorSettings | null; disabled: boolean; onChange: (value: DirectorSettings | null) => void }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<DirectorProvider>(value?.provider ?? 'chatgpt');
  const [model, setModel] = useState<string>(value?.model ?? providers.chatgpt.model);
  const [baseUrl, setBaseUrl] = useState(value?.baseUrl ?? '');
  const [key, setKey] = useState(value?.key ?? '');
  const [connection, setConnection] = useState<ChatGptStatus>({ state: 'disconnected' });
  const [refresh, setRefresh] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || provider !== 'chatgpt') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      try {
        const response = await fetch(connectionUrl, { cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(result.error ?? '无法读取 ChatGPT 登录状态。');
        setConnection(result);
        if (result.state === 'waiting') timer = setTimeout(check, 1200);
        if (result.state === 'connected' && result.model) setModel(current => current === providers.chatgpt.model ? result.model : current);
      } catch (cause) {
        if (!controller.signal.aborted) setConnection({ state: 'error', message: cause instanceof Error ? cause.message : '无法读取 ChatGPT 登录状态。' });
      }
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, provider, refresh]);

  async function connect() {
    setConnecting(true);
    setError('');
    setAuthorizationUrl('');
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    try {
      const response = await fetch(connectionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '无法发起 ChatGPT 登录。');
      const url = new URL(data.url);
      if (url.origin !== 'https://auth.openai.com') throw new Error('返回的登录地址无效。');
      if (popup && !popup.closed) popup.location.replace(url.href);
      else setAuthorizationUrl(url.href);
      setConnection({ state: 'waiting' });
      setRefresh(v => v + 1);
    } catch (cause) {
      popup?.close();
      setError(cause instanceof Error ? cause.message : '无法发起 ChatGPT 登录。');
    } finally { setConnecting(false); }
  }

  async function disconnect() {
    setConnecting(true);
    setError('');
    try {
      const response = await fetch(connectionUrl, { method: 'DELETE' });
      if (!response.ok) throw new Error('无法结束当前 ChatGPT 连接。');
      setConnection({ state: 'disconnected' });
      setAuthorizationUrl('');
      if (value?.provider === 'chatgpt') onChange(null);
      setRefresh(v => v + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法结束当前 ChatGPT 连接。'); }
    finally { setConnecting(false); }
  }

  function apply() {
    const parsedModel = modelSchema.safeParse(model);
    if (!parsedModel.success) { setError('请输入有效的模型 ID。'); return; }
    if (provider === 'chatgpt') {
      if (connection.state !== 'connected') { setError('请先完成 ChatGPT 登录。'); return; }
      onChange({ provider, model: parsedModel.data, key: '' });
    } else {
      const parsedBase = baseUrl.trim() ? baseUrlSchema.safeParse(baseUrl) : undefined;
      if (parsedBase && !parsedBase.success) { setError('请输入有效的 HTTPS Base URL，不能包含账号、查询参数或片段。'); return; }
      const parsedKey = keySchema.safeParse(key);
      if (!parsedKey.success) { setError('请填写该服务的 API Key。'); return; }
      onChange({ provider, model: parsedModel.data, key: parsedKey.data, baseUrl: parsedBase?.data });
    }
    setError('');
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="button button-ghost" disabled={disabled}><Settings size={16} /> AI 设置</DialogTrigger>
      <DialogContent className="guide-dialog ai-settings">
        <DialogClose className="icon-button dialog-close" aria-label="关闭 AI 设置"><X size={20} /></DialogClose>
        <DialogTitle>AI 导演设置</DialogTitle>
        <DialogDescription>选择支持图片和工具调用的模型。只在你确认定妆后，才会把角色图发给所选服务。</DialogDescription>
        <form onSubmit={event => { event.preventDefault(); apply(); }}>
          <label htmlFor="director-provider">接口协议</label>
          <select id="director-provider" value={provider} onChange={event => {
            const next = event.target.value as DirectorProvider;
            setProvider(next); setModel(providers[next].model); setKey(''); setError('');
          }}>
            {(Object.keys(providers) as DirectorProvider[]).map(id => <option key={id} value={id}>{providers[id].label}</option>)}
          </select>
          {provider !== 'chatgpt' && <>
            <label htmlFor="director-base-url">Base URL（可选）</label>
            <input id="director-base-url" inputMode="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder={providers[provider].baseUrl} maxLength={1024} autoComplete="off" spellCheck={false} aria-describedby="director-base-help" />
            <p id="director-base-help">留空使用默认地址。兼容网关请填 API 前缀（如包含 /v1）；仅填写你信任的公网 HTTPS 服务，网关会收到密钥与角色图。</p>
          </>}
          <label htmlFor="director-model">模型 ID</label>
          <input id="director-model" value={model} onChange={event => setModel(event.target.value)} maxLength={180} autoComplete="off" spellCheck={false} />
          {provider === 'chatgpt' ? <div className="ai-connection">
            <p>本机运行时可使用符合条件的 ChatGPT 订阅额度，不需要 API Key。</p>
            <p role="status">{connection.state === 'connected' ? 'ChatGPT 已连接' : connection.state === 'waiting' ? '请在登录页完成授权…' : connection.message ?? 'ChatGPT 未连接'}</p>
            {authorizationUrl && connection.state === 'waiting' && <a href={authorizationUrl} target="_blank" rel="noreferrer">打开官方登录页</a>}
            {connection.state === 'connected' || connection.state === 'waiting'
              ? <Button className="button button-secondary" type="button" disabled={connecting} onClick={() => void disconnect()}>断开当前连接</Button>
              : <Button className="button button-secondary" type="button" disabled={connecting} onClick={() => void connect()}>使用 ChatGPT 登录</Button>}
          </div> : <>
            <label htmlFor="director-key">API Key</label>
            <input id="director-key" type="password" value={key} maxLength={1024} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false} />
            <p>密钥只保留在当前页面，刷新后需要重新填写，不会写入本地文件。</p>
          </>}
          {error && <p role="alert" className="error-message">{error}</p>}
          <Button className="button button-primary" type="submit">应用设置</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
