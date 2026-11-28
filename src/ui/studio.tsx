"use client";

import { useEffect, useRef, useState, type DragEvent, type MouseEvent } from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import Link from "next/link";
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
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
} from "@ui-sdk/react/slider";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Film,
  FolderHeart,
  Heart,
  ImagePlus,
  Info,
  Layers,
  MonitorPlay,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  characterImageType,
  IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
} from "@/lib/character-image";
import { Mascot, type Actor, type Mood } from "./mascot";
import { DirectorRuntime } from "@/director/runtime";
import { providers, type DirectorSettings } from "@/director/settings";
import { AiSettings } from "./ai-settings";
import type { ActorPlan } from "@/model/actor-plan";
import type { ModelInfo, StageLoadFailure } from "@/stage/model-stage";

type ReadyAsset = { glb: Blob; download: string; bones: number };
const ModelStage = dynamic(
  () => import("@/stage/model-stage").then((m) => m.ModelStage),
  { ssr: false },
);
const PortraitWorkspace = dynamic(
  () => import("./portrait-workspace").then((m) => m.PortraitWorkspace),
  { ssr: false },
);

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function DressingProgress({
  startedAt,
  status,
}: {
  startedAt: number;
  status: string;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(
      () => setSeconds(Math.floor((performance.now() - startedAt) / 1_000)),
      250,
    );
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return (
    <div className="model-wait">
      <div className="model-wait-heading">
        <p role="status">
          <span className="wait-pulse" aria-hidden="true" />
          {status}
        </p>
        <time dateTime={`PT${seconds}S`}>
          已用 {Math.floor(seconds / 60).toString().padStart(2, "0")}:
          {(seconds % 60).toString().padStart(2, "0")}
        </time>
      </div>
      <progress aria-label={status} />
    </div>
  );
}

const actors: { id: Actor; name: string; description: string; tag: string }[] =
  [
    {
      id: "bunny",
      name: "糯叽兔",
      description: "看起来很好捏的样子",
      tag: "人气演员",
    },
    {
      id: "cat",
      name: "蓝莓喵",
      description: "今天也有在认真摸鱼",
      tag: "摸鱼搭子",
    },
    {
      id: "slime",
      name: "啵啵冻",
      description: "一只情绪不太稳定的果冻",
      tag: "天生戏精",
    },
  ];
const moods: { id: Mood; label: string; caption: string }[] = [
  { id: "happy", label: "下班了", caption: "好耶！下班咯！" },
  { id: "speechless", label: "无语", caption: "我能说什么呢…" },
  { id: "crazy", label: "裂开", caption: "精神状态非常美丽！" },
];
const steps = [
  { icon: ImagePlus, title: "选角", description: "带上你的角色" },
  { icon: Box, title: "定妆", description: "保留原画 · 本机抠图" },
  { icon: Clapperboard, title: "开拍", description: "用指令导演演出" },
  { icon: Film, title: "杀青", description: "透明 GIF 导出" },
];

function Guide() {
  return (
    <Dialog>
      <DialogTrigger className="button button-ghost topbar-action-btn help-button">
        <CircleHelp size={15} />
        <span>片场指南</span>
      </DialogTrigger>
      <DialogContent className="guide-dialog">
        <DialogClose
          className="icon-button dialog-close"
          aria-label="关闭指南"
        >
          <X size={18} />
        </DialogClose>
        <span className="eyebrow">
          <Clapperboard size={14} /> PAJI STUDIO GUIDE
        </span>
        <DialogTitle>欢迎来到你的脑洞片场</DialogTitle>
        <DialogDescription>
          一张角色图，一句小情绪，就是一部表情包大片的开始。
        </DialogDescription>
        <ol className="guide-steps">
          {steps.map((step, index) => (
            <li key={step.title}>
              <span className="guide-step-num">0{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.description}</p>
              </div>
              <span className="guide-step-icon">
                <step.icon size={18} />
              </span>
            </li>
          ))}
        </ol>
        <div className="notice">
          <Info size={16} />
          <p>
            上传图片后先在本机定妆，再输入想演的动作。确认发送透明图和指令后，AI 导演会编排演出；你可以预览并导出透明 GIF。可旋转的粗略模型另有「实验性 3D」入口。
          </p>
        </div>
        <DialogClose className="button button-primary guide-confirm">
          知道啦，开玩！
          <ArrowRight size={16} />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

export function Studio() {
  const [view, setView] = useState("studio");
  const [actor, setActor] = useState<Actor>("bunny");
  const [mood, setMood] = useState<Mood>("happy");
  const [playing, setPlaying] = useState(true);
  const [intensity, setIntensity] = useState(6);
  const [showCaption, setShowCaption] = useState(true);
  const [upload, setUpload] = useState<{
    url: string;
    name: string;
    file: File;
  } | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [consent, setConsent] = useState(false);
  const [ai, setAi] = useState<DirectorSettings | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [portraitBusy, setPortraitBusy] = useState(false);
  const portraitBusyRef = useRef(false);
  const busy = startedAt !== null || portraitBusy;
  const [asset, setAsset] = useState<ReadyAsset | null>(null);
  const [pendingGlb, setPendingGlb] = useState<Blob | null>(null);
  const [actorMode, setActorMode] = useState<"portrait" | "volume">("portrait");
  const [portraitProgress, setPortraitProgress] = useState<"ready" | "performed" | "exported" | null>(null);
  const [skeleton, setSkeleton] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [modelError, setModelError] = useState("");
  const [compactNav, setCompactNav] = useState(false);
  const plan = useRef<ActorPlan | null>(null);
  const director = useRef<DirectorRuntime | null>(null);
  const run = useRef<AbortController | null>(null);
  const selection = useRef(0);
  const load = useRef<{
    blob: Blob;
    settle: (info?: ModelInfo, failure?: StageLoadFailure) => boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [previewUpload, setPreviewUpload] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const previewPanelRef = useRef<HTMLElement>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const aiReturnFocusRef = useRef<HTMLElement | null>(null);
  const [previewFocusNonce, setPreviewFocusNonce] = useState<{
    id: number;
    moveFocus: boolean;
  } | null>(null);
  const selectedActor = actors.find((item) => item.id === actor)!;
  const hasUpload = upload !== null;

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    const mq = window.matchMedia("(max-width: 960px)");
    const sync = () => setCompactNav(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Scroll & optionally move keyboard focus to Preview AFTER layout commits
  useEffect(() => {
    if (!previewFocusNonce) return;
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    if (!window.matchMedia("(max-width: 960px)").matches) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const raf = window.requestAnimationFrame(() => {
      const target = previewPanelRef.current;
      if (target) {
        const top =
          target.getBoundingClientRect().top + window.scrollY - 64;
        window.scrollTo({
          top: Math.max(0, top),
          behavior: reduced ? "auto" : "smooth",
        });
      }
      if (previewFocusNonce.moveFocus) {
        previewHeadingRef.current?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [previewFocusNonce]);

  useEffect(() => {
    if (!hasUpload || actorMode !== 'volume') return;
    let active = true;
    void DirectorRuntime.supported()
      .catch(() => false)
      .then((canDirect) => {
        if (active) setSupported(canDirect);
      });
    return () => {
      active = false;
    };
  }, [hasUpload, actorMode]);

  useEffect(() => {
    return () => {
      if (upload) URL.revokeObjectURL(upload.url);
    };
  }, [upload]);

  useEffect(
    () => () => {
      selection.current++;
      run.current?.abort();
      director.current?.close();
    },
    [],
  );

  useEffect(
    () => () => {
      if (asset) URL.revokeObjectURL(asset.download);
    },
    [asset],
  );

  function schedulePreviewJump(moveFocus = false) {
    setPreviewFocusNonce((prev) => ({
      id: (prev?.id ?? 0) + 1,
      moveFocus,
    }));
  }

  function handleAiOpenChange(next: boolean) {
    setAiDialogOpen(next);
    if (!next && aiReturnFocusRef.current) {
      const target = aiReturnFocusRef.current;
      aiReturnFocusRef.current = null;
      window.requestAnimationFrame(() => {
        if (target.isConnected) target.focus();
      });
    }
  }

  function resetModel() {
    director.current?.close();
    director.current = null;
    plan.current = null;
    setConsent(false);
    setAsset(null);
    setPendingGlb(null);
    setActorMode("portrait");
    setPortraitProgress(null);
    setStatus("");
    setModelError("");
  }

  async function selectFile(file?: File) {
    if (!file || run.current || portraitBusyRef.current) return;
    const version = ++selection.current;
    if (!IMAGE_TYPES.some((type) => type === file.type)) {
      setError("这位演员的档案格式不支持，请选择 PNG、JPG 或 WebP 图片。");
      return;
    }
    if (!file.size || file.size > MAX_IMAGE_BYTES) {
      setError("请使用不超过 10 MiB 的有效角色图。");
      return;
    }
    try {
      if (
        characterImageType(
          new Uint8Array(await file.slice(0, 12).arrayBuffer()),
        ) !== file.type
      )
        throw new Error("图片格式不符");
      const bitmap = await createImageBitmap(file);
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (pixels > MAX_IMAGE_PIXELS) {
        if (version === selection.current)
          setError("角色图像素数过大，请缩小图片后重试。");
        return;
      }
    } catch {
      if (version === selection.current)
        setError("图片无法读取，请换一张有效的角色图。");
      return;
    }
    if (version !== selection.current || run.current || portraitBusyRef.current) return;
    resetModel();
    setError("");
    setUpload({ url: URL.createObjectURL(file), name: file.name, file });
    setPreviewUpload(true);
    schedulePreviewJump(false);
  }

  function configureAi(next: DirectorSettings | null) {
    setConsent(false);
    setAi(next);
    plan.current = null;
    director.current?.close();
    director.current = null;
  }

  async function generateModel() {
    if (!upload || !consent || !supported || !ai || run.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    run.current = controller;
    setStartedAt(performance.now());
    setModelError("");
    try {
      if (!plan.current) {
        setStatus("AI 导演正在分析角色图…");
        director.current ??= new DirectorRuntime(ai);
        plan.current = await director.current.design(upload.file, signal);
      }
      signal.throwIfAborted();
      setStatus("在浏览器中搭建模型和骨骼…");
      const { buildActorGlb } = await import("@/model/build-actor");
      const glb = await buildActorGlb(plan.current, signal);
      signal.throwIfAborted();
      setStatus("正在载入 3D 演员…");
      await new Promise<void>((resolve, reject) => {
        function settle(info?: ModelInfo, failure?: StageLoadFailure) {
          if (load.current !== request) return false;
          clearTimeout(timer);
          signal.removeEventListener("abort", cancel);
          load.current = null;
          setPendingGlb(null);
          if (signal.aborted || failure || !info) {
            reject(
              signal.aborted
                ? signal.reason
                : new Error(failure?.message ?? "未检测到有效的模型。"),
            );
            return false;
          }
          setAsset({
            glb,
            download: URL.createObjectURL(glb),
            bones: info.bones,
          });
          resolve();
          return true;
        }
        const request = { blob: glb, settle };
        const cancel = () => settle();
        const timer = setTimeout(
          () => settle(undefined, { message: "模型加载超时，请重试。" }),
          60_000,
        );
        signal.addEventListener("abort", cancel, { once: true });
        load.current = request;
        setPendingGlb(glb);
      });
      setStatus("定妆完成 · 已绑定骨骼");
    } catch (cause) {
      setStatus(signal.aborted ? "已停止定妆" : "定妆暂停");
      if (!signal.aborted)
        setModelError(
          cause instanceof Error ? cause.message : "定妆失败，请重试。",
        );
    } finally {
      run.current = null;
      setStartedAt(null);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files[0]);
  }

  function chooseActor(next: Actor, event: MouseEvent<HTMLElement>) {
    if (run.current || portraitBusyRef.current) return;
    setActor(next);
    setPreviewUpload(false);
    setPlaying(true);
    schedulePreviewJump(event.detail === 0);
  }

  const stageGlb = pendingGlb ?? asset?.glb;
  const portraitMode = actorMode === "portrait";
  const showModel = previewUpload && !portraitMode && Boolean(stageGlb);

  return (
    <Tabs
      className="app-shell"
      value={view}
      onValueChange={(next) => {
        if (next) setView(next);
      }}
      orientation={compactNav ? "horizontal" : "vertical"}
    >
      <aside className="sidebar">
        <div className="sidebar-brand-group">
          <Link className="brand" href="/" aria-label="啪叽 Paji 首页">
            <span className="brand-mark">
              <Clapperboard size={20} strokeWidth={2.4} />
            </span>
            <span className="brand-wordmark">
              啪叽
              <span className="brand-en">
                paji<span>®</span>
              </span>
            </span>
          </Link>
          <p className="sidebar-label">你的脑洞，专属片场</p>
        </div>

        <TabsList className="sidebar-nav" aria-label="主导航">
          <TabsTab value="studio" className="nav-item">
            <Clapperboard size={17} />
            <span>创作片场</span>
            <Sparkles size={14} className="nav-sparkle" />
          </TabsTab>
          <TabsTab value="works" className="nav-item" disabled={busy}>
            <FolderHeart size={17} />
            <span>我的作品</span>
            <span className="nav-count">0</span>
          </TabsTab>
        </TabsList>

        <div className="sidebar-note" aria-hidden="true">
          <span className="note-tape" />
          <span className="note-star">✦</span>
          <p>
            <span className="note-line">一点脑洞，</span>
            <span className="note-line">
              一吨<em>可爱。</em>
            </span>
          </p>
          <div className="note-doodle">
            <Heart size={15} />
            <span>MAKE IT FUN!</span>
          </div>
        </div>

        <div className="sidebar-bottom">
          <span className="local-dot" />
          <div>
            <strong>灵感就存在这里</strong>
            <p>无须登录，自由创作</p>
          </div>
          <Heart size={14} />
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span className="breadcrumb-root">我的工作台</span>
            <ChevronRight size={14} className="breadcrumb-sep" />
            <strong className="breadcrumb-current">
              {view === "studio" ? "创作片场" : "我的作品"}
            </strong>
            <span className="beta-tag">BETA</span>
          </div>
          <div className="topbar-actions">
            <AiSettings
              value={ai}
              disabled={busy}
              needsConfig={hasUpload && !portraitMode && !ai}
              onChange={configureAi}
              open={aiDialogOpen}
              onOpenChange={handleAiOpenChange}
            />
            <Guide />
          </div>
        </header>

        <main id="main-content">
          <TabsPanel value="studio" className="workspace-panel">
            <div className="page-heading">
              <div className="page-heading-copy">
                <div className="eyebrow">
                  <span className="pink-dot" /> WELCOME TO YOUR LITTLE STUDIO
                </div>
                <h1>
                  让脑洞，
                  <span>
                    动起来
                    <svg viewBox="0 0 160 10" aria-hidden="true">
                      <path d="M3 7Q75 0 157 6" />
                    </svg>
                  </span>
                  <span className="heading-spark" aria-hidden="true">
                    ✦
                  </span>
                </h1>
                <p>把你的角色捏成会动的表情包。可爱，根本藏不住。</p>
              </div>
              <div className="heading-sticker" aria-hidden="true">
                <span className="sticker-kicker">今日宜</span>
                <div className="sticker-body">
                  <strong>放飞脑洞</strong>
                  <Sparkles size={14} />
                </div>
              </div>
            </div>

            <section className="workflow" aria-label="创作流程">
              {steps.map((step, index) => {
                const dressed = portraitMode ? portraitProgress !== null : Boolean(asset);
                const performed = portraitMode && (portraitProgress === "performed" || portraitProgress === "exported");
                const exported = portraitMode && portraitProgress === "exported";
                const isDone = (index === 0 && hasUpload) || (index === 1 && dressed) ||
                  (index === 2 && performed) || (index === 3 && exported);
                const isCurrent = (index === 0 && !hasUpload) || (previewUpload && !exported && (
                  (index === 1 && !dressed) || (index === 2 && portraitMode && dressed && !performed) || (index === 3 && performed)
                ));
                return (
                  <div
                    key={step.title}
                    className={cn(
                      "workflow-step",
                      isCurrent && "current",
                      isDone && "completed",
                    )}
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    <span className="step-badge">
                      {isDone ? (
                        <Check size={12} strokeWidth={2.8} />
                      ) : (
                        <span className="step-number">0{index + 1}</span>
                      )}
                    </span>
                    <span className="step-icon">
                      <step.icon size={15} />
                    </span>
                    <div className="step-copy">
                      <strong>{step.title}</strong>
                      <span>{step.description}</span>
                    </div>
                    {index < steps.length - 1 && (
                      <ChevronRight
                        className="step-arrow"
                        size={14}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                );
              })}
            </section>

            <div className="studio-grid">
              <div className="casting-column">
                <section
                  className="panel casting-panel"
                  aria-labelledby="casting-title"
                >
                  <div className="section-heading">
                    <div className="section-title">
                      <span className="section-icon pink">
                        {upload ? (
                          <Check size={16} strokeWidth={2.6} />
                        ) : (
                          <ImagePlus size={16} />
                        )}
                      </span>
                      <h2 id="casting-title">
                        {upload ? "演员已就位" : "今天，谁来当主角？"}
                      </h2>
                    </div>
                    <span className="small-label">
                      {upload ? "ACT 01 · 已选角" : "ACT 01 / 选角"}
                    </span>
                  </div>
                  <p className="section-description">
                    {upload
                      ? "可在「片场偷看」保留原画、输入开拍指令并导出 GIF，或替换原图。"
                      : "一张立绘、一个头像，甚至是随手画的小家伙。"}
                  </p>
                  <input
                    ref={input}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="visually-hidden"
                    aria-label="选择角色图片"
                    tabIndex={-1}
                    onChange={(event) => {
                      selectFile(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                  <div
                    className={cn(
                      "upload-zone",
                      dragging && "dragging",
                      upload && "has-upload",
                    )}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={onDrop}
                  >
                    {upload ? (
                      <div className="uploaded-card">
                        <div className="uploaded-image">
                          <Image
                            unoptimized
                            width={108}
                            height={108}
                            src={upload.url}
                            alt="已选择的角色原图"
                            onError={() => {
                              setError("图片无法读取，请换一张有效的角色图。");
                              setUpload(null);
                              setPreviewUpload(false);
                            }}
                          />
                          <span className="uploaded-badge">
                            <Check size={11} strokeWidth={2.8} />
                            本地原图
                          </span>
                        </div>
                        <div className="uploaded-meta">
                          <strong className="uploaded-name" title={upload.name}>
                            {upload.name}
                          </strong>
                          <span className="uploaded-size">
                            {formatFileSize(upload.file.size)} · 本地暂存
                          </span>
                        </div>
                        <div className="uploaded-actions">
                          {!previewUpload && (
                            <Button
                              className="button button-secondary"
                              onClick={(event) => {
                                setPreviewUpload(true);
                                schedulePreviewJump(event.detail === 0);
                              }}
                            >
                              <MonitorPlay size={15} /> 返回我的演员
                            </Button>
                          )}
                          <Button
                            className="button button-subtle"
                            disabled={busy}
                            onClick={() => input.current?.click()}
                          >
                            <Upload size={15} />
                            换一位演员
                          </Button>
                        </div>
                        <Button
                          className="remove-upload"
                          disabled={busy}
                          onClick={() => {
                            selection.current++;
                            resetModel();
                            setError("");
                            setUpload(null);
                            setPreviewUpload(false);
                          }}
                        >
                          <Trash2 size={13} />
                          移除图片
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="upload-art" aria-hidden="true">
                          <div className="art-back" />
                          <div className="art-front">
                            <ImagePlus size={28} strokeWidth={1.6} />
                            <span />
                          </div>
                          <span className="art-spark">✧</span>
                          <span className="art-plus">+</span>
                        </div>
                        <h3>
                          {dragging
                            ? "松手，让主角登场！"
                            : "把角色拖到这里，让可爱发生"}
                        </h3>
                        <p>有点呆也没关系，戏精都是天生的。</p>
                        <Button
                          className="button button-primary upload-cta"
                          onClick={() => input.current?.click()}
                        >
                          <Plus size={17} />
                          选择角色图片
                          <ArrowUpRight size={15} />
                        </Button>
                        <span className="upload-formats">
                          支持 PNG / JPG / WebP · 最大 10 MiB
                        </span>
                      </>
                    )}
                  </div>
                  <div className="upload-status" aria-live="polite">
                    {error ? (
                      <p className="error-message">
                        <Info size={14} />
                        <span>{error}</span>
                      </p>
                    ) : (
                      <p>
                        <span className="tiny-lock" aria-hidden="true">
                          <Layers size={13} />
                        </span>
                        <span>选择图片不会上传；请 AI 导演定妆或开拍前会征求你的同意。</span>
                      </p>
                    )}
                  </div>
                </section>

                <section
                  className="samples-section"
                  aria-labelledby="samples-title"
                >
                  <div className="samples-heading">
                    <h2 id="samples-title">没带演员？先和 TA 们玩玩</h2>
                    {compactNav ? (
                      <Button
                        type="button"
                        className="samples-jump"
                        onClick={(event) => {
                          setPreviewUpload(false);
                          schedulePreviewJump(event.detail === 0);
                        }}
                      >
                        去舞台试戏 <ArrowDown size={13} />
                      </Button>
                    ) : (
                      <span className="samples-hint">免上传，点选即刻试戏</span>
                    )}
                  </div>
                  <div className="sample-grid">
                    {actors.map((item) => (
                      <Button
                        key={item.id}
                        className={cn(
                          "sample-card",
                          `sample-${item.id}`,
                          actor === item.id && !previewUpload && "selected",
                        )}
                        aria-pressed={actor === item.id && !previewUpload}
                        disabled={busy}
                        onClick={(event) => chooseActor(item.id, event)}
                      >
                        <span className="sample-illustration">
                          <Mascot actor={item.id} miniature playing={false} />
                          <span className="sample-tag">{item.tag}</span>
                          <span className="sample-check" aria-hidden="true">
                            <Check size={12} strokeWidth={2.8} />
                          </span>
                        </span>
                        <span className="sample-info">
                          <strong>{item.name}</strong>
                          <span>{item.description}</span>
                        </span>
                      </Button>
                    ))}
                  </div>
                </section>

                <div className="director-note">
                  <span className="director-avatar" aria-hidden="true">
                    <Clapperboard size={18} />
                  </span>
                  <div className="director-note-copy">
                    <strong>
                      导演的小声提醒<span>DIRECTOR’S NOTE</span>
                    </strong>
                    <p>
                      角色越简单，演技越放飞。毕竟，谁能拒绝一只会发疯的团子呢？
                    </p>
                  </div>
                  <Sparkles
                    size={17}
                    className="director-sparkle"
                    aria-hidden="true"
                  />
                </div>
              </div>

              <section
                ref={previewPanelRef}
                className="panel preview-panel"
                aria-labelledby="preview-title"
              >
                <div className="section-heading">
                  <div className="section-title">
                    <span className="section-icon blue">
                      <MonitorPlay size={16} />
                    </span>
                    <h2
                      id="preview-title"
                      ref={previewHeadingRef}
                      tabIndex={-1}
                      className="preview-heading-anchor"
                    >
                      片场偷看
                    </h2>
                  </div>
                  <span
                    className={cn(
                      "live-tag",
                      ((showModel && asset) || (previewUpload && portraitMode && portraitProgress)) && "live-tag-ready",
                      busy && "live-tag-busy",
                    )}
                  >
                    <span aria-hidden="true" />
                    {showModel
                      ? asset
                        ? "已绑定骨骼"
                        : "加载模型中"
                      : previewUpload
                        ? portraitMode && portraitProgress ? "原画就绪" : "本地预览"
                        : "示例预览"}
                  </span>
                </div>

                {previewUpload && upload && (
                  <div className="portrait-mode-choice" role="group" aria-label="角色生成方式">
                    <Button className="button button-secondary" aria-pressed={portraitMode} disabled={busy}
                      onClick={() => setActorMode("portrait")}>原画开拍</Button>
                    <Button className="button button-secondary" aria-pressed={!portraitMode} disabled={busy}
                      onClick={() => setActorMode("volume")}>实验性 3D</Button>
                  </div>
                )}
                {upload && <div key={upload.url} hidden={!previewUpload || !portraitMode}>
                  <PortraitWorkspace file={upload.file} url={upload.url} ai={ai}
                    onOpenAi={button => { aiReturnFocusRef.current = button; setAiDialogOpen(true); }}
                    visible={view === "studio" && previewUpload && portraitMode} onProgress={setPortraitProgress}
                    onBusy={next => { portraitBusyRef.current = next; setPortraitBusy(next); }} />
                </div>}
                {!(previewUpload && upload && portraitMode) && <>
                <div
                  className={cn(
                    "preview-stage",
                    previewUpload && "image-stage",
                    showModel && "stage-3d",
                  )}
                >
                  <div className="stage-grid" />
                  <span className="stage-corner corner-tl" aria-hidden="true" />
                  <span className="stage-corner corner-tr" aria-hidden="true" />
                  <span className="stage-corner corner-bl" aria-hidden="true" />
                  <span className="stage-corner corner-br" aria-hidden="true" />
                  <span className="stage-label">
                    {showModel
                      ? "PAJI / 3D STAGE"
                      : previewUpload
                        ? "ORIGINAL IMAGE"
                        : "PAJI / LITTLE THEATER"}
                  </span>

                  {showModel && stageGlb ? (
                    <>
                      <ModelStage
                        blob={stageGlb}
                        rigged
                        skeleton={skeleton}
                        visible={view === "studio"}
                        onInfo={(blob, info) =>
                          load.current?.blob === blob
                            ? load.current.settle(info)
                            : asset?.glb === blob
                        }
                        onError={(blob, failure) => {
                          if (load.current?.blob === blob)
                            load.current.settle(undefined, failure);
                        }}
                      />
                      <span className="stage-orbit-hint">
                        拖动旋转 · 滚轮缩放
                      </span>
                    </>
                  ) : previewUpload && upload ? (
                    <div className="original-preview">
                      <div className="original-frame">
                        <Image
                          unoptimized
                          width={400}
                          height={400}
                          src={upload.url}
                          alt="上传角色的本地预览"
                        />
                      </div>
                      <span className="original-caption">
                        原图预览 · 确认后开始 AI 定妆
                      </span>
                    </div>
                  ) : (
                    <>
                      <span
                        className="stage-sticker sticker-happy"
                        aria-hidden="true"
                      >
                        {mood === "speechless"
                          ? "…"
                          : mood === "crazy"
                            ? "啊啊啊！"
                            : "好耶！"}
                      </span>
                      <span className="stage-spark spark-one" aria-hidden="true">
                        ✦
                      </span>
                      <span className="stage-spark spark-two" aria-hidden="true">
                        ✧
                      </span>
                      <Mascot
                        actor={actor}
                        mood={mood}
                        playing={playing}
                        intensity={intensity}
                      />
                      {showCaption && (
                        <span className="stage-caption" key={mood}>
                          {moods.find((item) => item.id === mood)?.caption}
                        </span>
                      )}
                      <Button
                        className="icon-button play-toggle"
                        onClick={() => setPlaying(!playing)}
                        aria-label={playing ? "暂停预览动画" : "播放预览动画"}
                      >
                        {playing ? (
                          <Pause size={14} fill="currentColor" />
                        ) : (
                          <Play size={14} fill="currentColor" />
                        )}
                      </Button>
                    </>
                  )}
                </div>

                <div className="preview-controls">
                  <div className="preview-actor-row">
                    <div>
                      <strong>
                        {previewUpload ? "你的专属演员" : selectedActor.name}
                        <span>
                          {showModel && asset
                            ? "3D RIGGED"
                            : previewUpload
                              ? "ORIGINAL"
                              : "DEMO ACTOR"}
                        </span>
                      </strong>
                      <p>
                        {showModel && asset
                          ? `已完成 3D 建模与骨骼绑定（${asset.bones} 根骨骼），可拖动观察或下载 GLB。`
                          : previewUpload
                            ? ai
                              ? `已连接 ${ai.model}，勾选下方确认后即可开始 3D 定妆。`
                              : "已载入本地原图，配置 AI 导演后即可生成 3D 演员。"
                            : "小小一只，情绪倒是不少。"}
                      </p>
                    </div>
                  </div>

                  {previewUpload ? (
                    <div className="model-controls">
                      {!asset && !ai && (
                        <div className="ai-setup-callout">
                          <div className="ai-setup-callout-body">
                            <Settings size={15} aria-hidden="true" />
                            <p>尚未配置 AI 导演，请先选择服务和模型。</p>
                          </div>
                          <Button
                            className="button button-primary ai-setup-shortcut"
                            disabled={busy}
                            onClick={(event) => {
                              aiReturnFocusRef.current = event.currentTarget;
                              setAiDialogOpen(true);
                            }}
                          >
                            打开 AI 设置
                          </Button>
                        </div>
                      )}
                      {!asset && ai && (
                        <label
                          className={cn(
                            "consent-card",
                            consent && "is-checked",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={consent}
                            disabled={busy}
                            onChange={(event) =>
                              setConsent(event.target.checked)
                            }
                          />
                          <span>
                            我有权使用这张图片，并同意发送给{" "}
                            <strong>
                              {ai.baseUrl
                                ? new URL(ai.baseUrl).host
                                : providers[ai.provider].label}
                            </strong>{" "}
                            分析。模型和骨骼在本地生成。
                          </span>
                        </label>
                      )}
                      {!busy && !asset && (
                        <Button
                          className="button button-primary model-submit-btn"
                          disabled={!consent || !ai || supported !== true}
                          onClick={() => void generateModel()}
                        >
                          <WandSparkles size={16} />{" "}
                          {status ? "继续定妆" : "生成模型并绑定骨骼"}
                        </Button>
                      )}
                      {supported === null && (
                        <p className="model-meta-note">
                          正在检查浏览器是否支持 3D 定妆…
                        </p>
                      )}
                      {supported === false && (
                        <p className="form-alert">
                          <Info size={15} aria-hidden="true" />
                          <span>
                            当前浏览器不支持 WebAssembly JSPI，请使用最新版 Chrome 或 Safari 27+。
                          </span>
                        </p>
                      )}
                      {startedAt !== null ? (
                        <div className="model-busy-stack">
                          <DressingProgress
                            startedAt={startedAt}
                            status={status}
                          />
                          <Button
                            className="button button-secondary model-stop-btn"
                            onClick={() => run.current?.abort()}
                          >
                            停止定妆
                          </Button>
                        </div>
                      ) : (
                        status && (
                          <p role="status" className="model-status-pill">
                            <ShieldCheck size={14} aria-hidden="true" />
                            <span>{status}</span>
                          </p>
                        )
                      )}
                      {modelError && (
                        <p role="alert" className="form-alert">
                          <Info size={15} aria-hidden="true" />
                          <span>{modelError}</span>
                        </p>
                      )}
                      {asset && (
                        <div className="asset-ready-bar">
                          <label className="skeleton-toggle">
                            <input
                              type="checkbox"
                              checked={skeleton}
                              onChange={(event) =>
                                setSkeleton(event.target.checked)
                              }
                            />
                            <span>显示骨骼（{asset.bones} 根）</span>
                          </label>
                          <a
                            className="button button-secondary"
                            href={asset.download}
                            download="paji-rigged.glb"
                          >
                            下载 GLB <ArrowDown size={15} />
                          </a>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <Tabs
                        value={mood}
                        onValueChange={(next) => {
                          if (next) setMood(next);
                        }}
                      >
                        <div className="control-label">
                          <span>给 TA 一点小情绪</span>
                          <MousePointer2 size={13} aria-hidden="true" />
                        </div>
                        <TabsList
                          className="mood-tabs"
                          aria-label="示例演员情绪"
                        >
                          {moods.map((item) => (
                            <TabsTab key={item.id} value={item.id}>
                              {item.id === "happy" ? (
                                <Zap size={14} />
                              ) : item.id === "speechless" ? (
                                <span className="mood-dots">···</span>
                              ) : (
                                <Sparkles size={14} />
                              )}
                              {item.label}
                            </TabsTab>
                          ))}
                        </TabsList>
                        {moods.map((item) => (
                          <TabsPanel
                            key={item.id}
                            value={item.id}
                            className="visually-hidden"
                          >
                            {item.caption}，当前为本地动效示例。
                          </TabsPanel>
                        ))}
                      </Tabs>
                      <Slider<number>
                        value={intensity}
                        onValueChange={setIntensity}
                        min={0}
                        max={11}
                        step={1}
                        className="intensity-slider"
                      >
                        <div className="control-label">
                          <span>戏精指数</span>
                          <strong className="intensity-readout">
                            {intensity}
                            <span> / 11</span>
                          </strong>
                        </div>
                        <SliderControl className="slider-control">
                          <SliderTrack className="slider-track">
                            <SliderIndicator className="slider-indicator" />
                            <SliderThumb
                              className="slider-thumb"
                              aria-label="戏精指数"
                            />
                          </SliderTrack>
                        </SliderControl>
                        <div className="slider-captions">
                          <span>乖巧一点</span>
                          <span>彻底放飞</span>
                        </div>
                      </Slider>
                      <label className="caption-switch">
                        <span>
                          自带内心 OS<span>让可爱有话可说</span>
                        </span>
                        <Switch
                          checked={showCaption}
                          onCheckedChange={setShowCaption}
                          aria-label="显示内心 OS 字幕"
                          className="switch"
                        >
                          <SwitchThumb className="switch-thumb" />
                        </Switch>
                      </label>
                    </>
                  )}
                </div>

                <div className="preview-footer">
                  <WandSparkles size={14} aria-hidden="true" />
                  <span>
                    {previewUpload
                      ? "实验性 3D 可下载 GLB；需要保真 GIF 时请切换到「原画开拍」。"
                      : "这是示例动效，你的角色会有自己的戏。"}
                  </span>
                </div>
                </>}
              </section>
            </div>

            <footer className="workspace-footer">
              <span>
                MADE FOR YOUR WILD IMAGINATION
                <span className="footer-star" aria-hidden="true">
                  ✦
                </span>
              </span>
              <span>一点灵感，无限种可能。</span>
            </footer>
          </TabsPanel>

          <TabsPanel value="works" className="workspace-panel">
            <div className="page-heading">
              <div className="page-heading-copy">
                <div className="eyebrow">
                  <span className="pink-dot" /> YOUR LITTLE COLLECTION
                </div>
                <h1>
                  可爱，<span>收藏起来。</span>
                </h1>
                <p>以后每一次精彩表演，都会在这里相遇。</p>
              </div>
            </div>
            <section className="panel empty-portfolio">
              <div className="empty-emblem" aria-hidden="true">
                <span className="empty-card-back" />
                <span className="empty-icon">
                  <FolderHeart size={36} strokeWidth={1.6} />
                </span>
              </div>
              <h2>你的第一部作品，还在脑洞里</h2>
              <p>
                透明 GIF 可在片场直接下载到本机。作品档案尚未接通，不会自动保存。
              </p>
              <div className="empty-roadmap" aria-label="筹备中的能力">
                <span>本地作品档案 · 筹备中</span>
              </div>
              <Button
                className="button button-primary"
                onClick={() => setView("studio")}
              >
                <Clapperboard size={17} />
                去片场找找灵感
                <ArrowRight size={16} />
              </Button>
            </section>
          </TabsPanel>
        </main>
      </div>
    </Tabs>
  );
}
