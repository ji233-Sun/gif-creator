"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@ui-sdk/react/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  Lock,
  Settings,
  WandSparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  baseUrlSchema,
  keySchema,
  modelSchema,
  providers,
  type DirectorProvider,
  type DirectorSettings,
} from "@/director/settings";

type ChatGptStatus = {
  state: "disconnected" | "waiting" | "connected" | "error";
  message?: string;
  model?: string;
};
type FieldError = {
  field: "model" | "baseUrl" | "key" | "connection" | "general";
  message: string;
};
const connectionUrl = "/api/llm/chatgpt";

const providerOptionLabels: Record<DirectorProvider, string> = {
  chatgpt: "ChatGPT 订阅登录（Responses）",
  "openai-responses": "OpenAI API Key · Responses",
  "openai-chat": "OpenAI 兼容 API Key · Chat Completions",
  anthropic: "Anthropic 兼容 API Key · Messages",
  gemini: "Google Gemini API Key · Generate Content",
  deepseek: "DeepSeek API Key · Chat Completions",
  gateway: "Vercel AI Gateway Key · Chat Completions",
};

export function AiSettings({
  value,
  disabled,
  needsConfig = false,
  onChange,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  value: DirectorSettings | null;
  disabled: boolean;
  needsConfig?: boolean;
  onChange: (value: DirectorSettings | null) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;

  const [provider, setProvider] = useState<DirectorProvider>(
    value?.provider ?? "chatgpt",
  );
  const [model, setModel] = useState<string>(
    value?.model ?? providers.chatgpt.model,
  );
  const [baseUrl, setBaseUrl] = useState(value?.baseUrl ?? "");
  const [key, setKey] = useState(value?.key ?? "");
  const [showKey, setShowKey] = useState(false);
  const [connection, setConnection] = useState<ChatGptStatus>({
    state: "disconnected",
  });
  const [refresh, setRefresh] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [authorizationUrl, setAuthorizationUrl] = useState("");
  const [fieldError, setFieldError] = useState<FieldError | null>(null);

  const modelInputRef = useRef<HTMLInputElement>(null);
  const baseUrlInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const prevOpenRef = useRef(false);

  // Sync draft to applied settings whenever dialog opens (including controlled external open)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const nextProvider = value?.provider ?? "chatgpt";
      setProvider(nextProvider);
      setModel(value?.model ?? providers[nextProvider].model);
      setBaseUrl(value?.baseUrl ?? "");
      setKey(value?.key ?? "");
      setShowKey(false);
      setFieldError(null);
    }
    prevOpenRef.current = open;
  }, [open, value]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      const nextProvider = value?.provider ?? "chatgpt";
      setProvider(nextProvider);
      setModel(value?.model ?? providers[nextProvider].model);
      setBaseUrl(value?.baseUrl ?? "");
      setKey(value?.key ?? "");
      setShowKey(false);
      setFieldError(null);
    }
    setInternalOpen(next);
    controlledOnOpenChange?.(next);
  }

  useEffect(() => {
    if (!open || provider !== "chatgpt") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      try {
        const response = await fetch(connectionUrl, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok)
          throw new Error(result.error ?? "无法读取 ChatGPT 登录状态。");
        setConnection(result);
        if (result.state === "waiting") timer = setTimeout(check, 1200);
        if (result.state === "connected" && result.model)
          setModel((current) =>
            current === providers.chatgpt.model ? result.model : current,
          );
      } catch (cause) {
        if (!controller.signal.aborted)
          setConnection({
            state: "error",
            message:
              cause instanceof Error
                ? cause.message
                : "无法读取 ChatGPT 登录状态。",
          });
      }
    }
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, provider, refresh]);

  async function connect() {
    setConnecting(true);
    setFieldError(null);
    setAuthorizationUrl("");
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const response = await fetch(connectionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "无法发起 ChatGPT 登录。");
      const url = new URL(data.url);
      if (url.origin !== "https://auth.openai.com")
        throw new Error("返回的登录地址无效。");
      if (popup && !popup.closed) popup.location.replace(url.href);
      else setAuthorizationUrl(url.href);
      setConnection({ state: "waiting" });
      setRefresh((v) => v + 1);
    } catch (cause) {
      popup?.close();
      setFieldError({
        field: "connection",
        message:
          cause instanceof Error ? cause.message : "无法发起 ChatGPT 登录。",
      });
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    setConnecting(true);
    setFieldError(null);
    try {
      const response = await fetch(connectionUrl, { method: "DELETE" });
      if (!response.ok) throw new Error("无法结束当前 ChatGPT 连接。");
      setConnection({ state: "disconnected" });
      setAuthorizationUrl("");
      if (value?.provider === "chatgpt") onChange(null);
      setRefresh((v) => v + 1);
    } catch (cause) {
      setFieldError({
        field: "connection",
        message:
          cause instanceof Error
            ? cause.message
            : "无法结束当前 ChatGPT 连接。",
      });
    } finally {
      setConnecting(false);
    }
  }

  function apply() {
    if (provider !== "chatgpt") {
      const parsedBase = baseUrl.trim()
        ? baseUrlSchema.safeParse(baseUrl)
        : undefined;
      if (parsedBase && !parsedBase.success) {
        setFieldError({
          field: "baseUrl",
          message:
            "请输入有效的 HTTPS Base URL，不能包含账号、查询参数或片段。",
        });
        baseUrlInputRef.current?.focus();
        return;
      }
      const parsedModel = modelSchema.safeParse(model);
      if (!parsedModel.success) {
        setFieldError({ field: "model", message: "请输入有效的模型 ID。" });
        modelInputRef.current?.focus();
        return;
      }
      const parsedKey = keySchema.safeParse(key);
      if (!parsedKey.success) {
        setFieldError({
          field: "key",
          message: key.trim()
            ? "API Key 格式无效，请检查是否包含空格、换行或非 ASCII 字符。"
            : "请填写该服务的 API Key。",
        });
        keyInputRef.current?.focus();
        return;
      }
      onChange({
        provider,
        model: parsedModel.data,
        key: parsedKey.data,
        baseUrl: parsedBase?.data,
      });
    } else {
      const parsedModel = modelSchema.safeParse(model);
      if (!parsedModel.success) {
        setFieldError({ field: "model", message: "请输入有效的模型 ID。" });
        modelInputRef.current?.focus();
        return;
      }
      if (connection.state !== "connected") {
        setFieldError({
          field: "connection",
          message: "请先完成 ChatGPT 登录。",
        });
        return;
      }
      onChange({ provider, model: parsedModel.data, key: "" });
    }
    setFieldError(null);
    setInternalOpen(false);
    controlledOnOpenChange?.(false);
  }

  const connectionLabel =
    connection.state === "connected"
      ? "ChatGPT 已连接"
      : connection.state === "waiting"
        ? "请在登录页完成授权…"
        : (connection.message ?? "ChatGPT 未连接");

  const chatgptDisconnected =
    provider === "chatgpt" && connection.state !== "connected";
  const applyDisabled =
    chatgptDisconnected || (provider !== "chatgpt" && !key.trim());

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        className={cn(
          "button button-ghost topbar-action-btn ai-trigger",
          value && "is-configured",
          !value && needsConfig && "needs-config",
        )}
        disabled={disabled}
      >
        {(value || needsConfig) && (
          <span
            className={cn("ai-trigger-dot", value ? "active" : "pending")}
            aria-hidden="true"
          />
        )}
        <Settings size={15} />
        <span>AI 设置</span>
        {value && <span className="ai-trigger-model">{value.model}</span>}
      </DialogTrigger>
      <DialogContent className="guide-dialog ai-settings">
        <DialogClose
          className="icon-button dialog-close"
          aria-label="关闭 AI 设置"
        >
          <X size={18} />
        </DialogClose>
        <span className="eyebrow">
          <WandSparkles size={14} /> AI DIRECTOR CONFIG
        </span>
        <DialogTitle>AI 导演设置</DialogTitle>
        <DialogDescription>
          选择支持图片理解和工具调用的模型。只在你确认定妆后，才会把角色图发给所选服务。
        </DialogDescription>
        <form
          className="ai-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <div className="field-group">
            <label htmlFor="director-provider">服务与凭据</label>
            <div className="select-wrap">
              <select
                id="director-provider"
                value={provider}
                onChange={(event) => {
                  const next = event.target.value as DirectorProvider;
                  setProvider(next);
                  setModel(providers[next].model);
                  setBaseUrl("");
                  setKey("");
                  setShowKey(false);
                  setFieldError(null);
                }}
              >
                {(Object.keys(providers) as DirectorProvider[]).map((id) => (
                  <option key={id} value={id}>
                    {providerOptionLabels[id]}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="select-chevron"
                aria-hidden="true"
              />
            </div>
          </div>

          {provider !== "chatgpt" && (
            <div className="field-group">
              <label htmlFor="director-base-url">
                Base URL <span className="field-badge">可选</span>
              </label>
              <input
                ref={baseUrlInputRef}
                id="director-base-url"
                className={cn(
                  "mono-input",
                  fieldError?.field === "baseUrl" && "input-invalid",
                )}
                inputMode="url"
                value={baseUrl}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  if (fieldError?.field === "baseUrl") setFieldError(null);
                }}
                placeholder={providers[provider].baseUrl}
                maxLength={1024}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={fieldError?.field === "baseUrl" || undefined}
                aria-describedby={
                  fieldError?.field === "baseUrl"
                    ? "director-base-error"
                    : "director-base-help"
                }
              />
              {fieldError?.field === "baseUrl" ? (
                <p id="director-base-error" role="alert" className="field-error">
                  <Info size={13} aria-hidden="true" />
                  <span>{fieldError.message}</span>
                </p>
              ) : (
                <p id="director-base-help" className="field-hint">
                  留空使用默认地址。兼容网关请填 API 前缀（如包含 /v1）；仅填写你信任的公网 HTTPS 服务，网关会收到密钥与角色图。
                </p>
              )}
            </div>
          )}

          <div className="field-group">
            <label htmlFor="director-model">
              模型 ID <span className="field-badge required">必填</span>
            </label>
            <input
              ref={modelInputRef}
              id="director-model"
              className={cn(
                "mono-input",
                fieldError?.field === "model" && "input-invalid",
              )}
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                if (fieldError?.field === "model") setFieldError(null);
              }}
              maxLength={180}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={fieldError?.field === "model" || undefined}
              aria-describedby={
                fieldError?.field === "model"
                  ? "director-model-error"
                  : undefined
              }
            />
            {fieldError?.field === "model" && (
              <p id="director-model-error" role="alert" className="field-error">
                <Info size={13} aria-hidden="true" />
                <span>{fieldError.message}</span>
              </p>
            )}
          </div>

          {provider === "chatgpt" ? (
            <div className="ai-connection">
              <div className="ai-connection-head">
                <span
                  className={cn("status-pill", `status-${connection.state}`)}
                  role="status"
                >
                  <span className="status-dot" aria-hidden="true" />
                  {connectionLabel}
                </span>
              </div>
              <p className="ai-connection-desc">
                本机运行时可使用符合条件的 ChatGPT 订阅额度，不需要填写 API Key。完成登录后即可应用设置。
              </p>
              {authorizationUrl && connection.state === "waiting" && (
                <a
                  className="ai-auth-link"
                  href={authorizationUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开官方登录页
                  <ExternalLink size={13} />
                </a>
              )}
              <div className="ai-connection-actions">
                {connection.state === "connected" ||
                connection.state === "waiting" ? (
                  <Button
                    className="button button-subtle"
                    type="button"
                    disabled={connecting}
                    onClick={() => void disconnect()}
                  >
                    断开当前连接
                  </Button>
                ) : (
                  <Button
                    className="button button-primary"
                    type="button"
                    disabled={connecting}
                    onClick={() => void connect()}
                  >
                    使用 ChatGPT 登录
                  </Button>
                )}
              </div>
              {fieldError?.field === "connection" && (
                <p role="alert" className="field-error">
                  <Info size={13} aria-hidden="true" />
                  <span>{fieldError.message}</span>
                </p>
              )}
            </div>
          ) : (
            <div className="field-group">
              <label htmlFor="director-key">
                API Key <span className="field-badge required">必填</span>
              </label>
              <div className="input-with-action">
                <input
                  ref={keyInputRef}
                  id="director-key"
                  className={cn(
                    "mono-input",
                    fieldError?.field === "key" && "input-invalid",
                  )}
                  type={showKey ? "text" : "password"}
                  value={key}
                  maxLength={1024}
                  placeholder="sk-..."
                  onChange={(event) => {
                    setKey(event.target.value);
                    if (fieldError?.field === "key") setFieldError(null);
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={fieldError?.field === "key" || undefined}
                  aria-describedby={
                    fieldError?.field === "key"
                      ? "director-key-error"
                      : "director-key-help"
                  }
                />
                <Button
                  type="button"
                  className="input-eye-btn"
                  aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                  aria-pressed={showKey}
                  onClick={() => setShowKey((prev) => !prev)}
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </Button>
              </div>
              {fieldError?.field === "key" && (
                <p id="director-key-error" role="alert" className="field-error">
                  <Info size={13} aria-hidden="true" />
                  <span>{fieldError.message}</span>
                </p>
              )}
              <p id="director-key-help" className="field-hint field-hint-privacy">
                <Lock size={12} aria-hidden="true" />
                密钥只保留在当前页面，刷新后需要重新填写，不会写入本地文件。
              </p>
            </div>
          )}

          {fieldError?.field === "general" && (
            <p role="alert" className="form-alert">
              <Info size={15} aria-hidden="true" />
              <span>{fieldError.message}</span>
            </p>
          )}

          <div className="dialog-actions">
            <DialogClose className="button button-subtle" type="button">
              取消
            </DialogClose>
            <Button
              className="button button-primary"
              type="submit"
              disabled={applyDisabled}
            >
              <Check size={16} />
              应用设置
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
