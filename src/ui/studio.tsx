"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
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
  Sparkles,
  Upload,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { characterImageType, IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "@/lib/character-image";
import { Mascot, type Actor, type Mood } from "./mascot";
import { DirectorRuntime } from "@/director/runtime";
import { providers, type DirectorSettings } from "@/director/settings";
import { AiSettings } from "./ai-settings";
import type { ActorPlan } from "@/model/actor-plan";
import type { ModelInfo, StageLoadFailure } from "@/stage/model-stage";

type ReadyAsset = { glb: Blob; download: string; bones: number };
const ModelStage = dynamic(() => import("@/stage/model-stage").then((m) => m.ModelStage), { ssr: false });

function DressingProgress({ startedAt, status }: { startedAt: number; status: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(Math.floor((performance.now() - startedAt) / 1_000)), 250);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return (
    <div className="model-wait">
      <div className="model-wait-heading">
        <p role="status">{status}</p>
        <time dateTime={`PT${seconds}S`}>已用 {Math.floor(seconds / 60).toString().padStart(2, "0")}:{(seconds % 60).toString().padStart(2, "0")}</time>
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
  { icon: Box, title: "定妆", description: "变成 3D 小演员" },
  { icon: Clapperboard, title: "开拍", description: "让情绪演出来" },
  { icon: Film, title: "杀青", description: "带走你的表情包" },
];

function Guide() {
  return (
    <Dialog>
      <DialogTrigger className="button button-ghost help-button">
        <CircleHelp size={17} /> 片场指南
      </DialogTrigger>
      <DialogContent className="guide-dialog">
        <DialogClose className="icon-button dialog-close" aria-label="关闭指南">
          <X size={20} />
        </DialogClose>
        <span className="eyebrow">
          <Clapperboard size={15} /> PAJI STUDIO GUIDE
        </span>
        <DialogTitle>欢迎来到你的脑洞片场</DialogTitle>
        <DialogDescription>
          一张角色图，一句小情绪，就是一部表情包大片的开始。
        </DialogDescription>
        <ol className="guide-steps">
          {steps.map((step, index) => (
            <li key={step.title}>
              <span>{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.description}</p>
              </div>
              <step.icon size={22} />
            </li>
          ))}
        </ol>
        <div className="notice">
          <Info size={17} />
          <p>
            上传图片后可请 AI 导演生成模型并绑定骨骼；内置演员可体验示例情绪和动效。GIF 导出仍在筹备中。
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
  const [upload, setUpload] = useState<{ url: string; name: string; file: File } | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [consent, setConsent] = useState(false);
  const [ai, setAi] = useState<DirectorSettings | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const busy = startedAt !== null;
  const [asset, setAsset] = useState<ReadyAsset | null>(null);
  const [pendingGlb, setPendingGlb] = useState<Blob | null>(null);
  const [skeleton, setSkeleton] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [modelError, setModelError] = useState("");
  const plan = useRef<ActorPlan | null>(null);
  const director = useRef<DirectorRuntime | null>(null);
  const run = useRef<AbortController | null>(null);
  const selection = useRef(0);
  const load = useRef<{ blob: Blob; settle: (info?: ModelInfo, failure?: StageLoadFailure) => boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [previewUpload, setPreviewUpload] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const selectedActor = actors.find((item) => item.id === actor)!;
  const hasUpload = upload !== null;

  useEffect(() => {
    if (!hasUpload) return;
    let active = true;
    void DirectorRuntime.supported().catch(() => false).then(canDirect => {
      if (active) setSupported(canDirect);
    });
    return () => { active = false; };
  }, [hasUpload]);

  useEffect(() => {
    return () => {
      if (upload) URL.revokeObjectURL(upload.url);
    };
  }, [upload]);

  useEffect(() => () => {
    selection.current++;
    run.current?.abort();
    director.current?.close();
  }, []);

  useEffect(() => () => { if (asset) URL.revokeObjectURL(asset.download); }, [asset]);

  function resetModel() {
    director.current?.close();
    director.current = null;
    plan.current = null;
    setConsent(false);
    setAsset(null);
    setPendingGlb(null);
    setStatus("");
    setModelError("");
  }

  async function selectFile(file?: File) {
    if (!file || run.current) return;
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
      if (characterImageType(new Uint8Array(await file.slice(0, 12).arrayBuffer())) !== file.type) throw new Error("图片格式不符");
      const bitmap = await createImageBitmap(file);
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (pixels > MAX_IMAGE_PIXELS) {
        if (version === selection.current) setError("角色图像素数过大，请缩小图片后重试。");
        return;
      }
    } catch {
      if (version === selection.current) setError("图片无法读取，请换一张有效的角色图。");
      return;
    }
    if (version !== selection.current || run.current) return;
    resetModel();
    setError("");
    setUpload({ url: URL.createObjectURL(file), name: file.name, file });
    setPreviewUpload(true);
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
            reject(signal.aborted ? signal.reason : new Error(failure?.message ?? "未检测到有效的模型。"));
            return false;
          }
          setAsset({ glb, download: URL.createObjectURL(glb), bones: info.bones });
          resolve();
          return true;
        }
        const request = { blob: glb, settle };
        const cancel = () => settle();
        const timer = setTimeout(() => settle(undefined, { message: "模型加载超时，请重试。" }), 60_000);
        signal.addEventListener("abort", cancel, { once: true });
        load.current = request;
        setPendingGlb(glb);
      });
      setStatus("定妆完成 · 已绑定骨骼");
    } catch (cause) {
      setStatus(signal.aborted ? "已停止定妆" : "定妆暂停");
      if (!signal.aborted) setModelError(cause instanceof Error ? cause.message : "定妆失败，请重试。");
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

  function chooseActor(next: Actor) {
    setActor(next);
    setPreviewUpload(false);
    setPlaying(true);
  }

  const stageGlb = pendingGlb ?? asset?.glb;
  const showModel = previewUpload && Boolean(stageGlb);

  return (
    <Tabs
      className="app-shell"
      value={view}
      onValueChange={(next) => {
        if (next) setView(next);
      }}
      orientation="vertical"
    >
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="啪叽 Paji 首页">
          <span className="brand-mark">
            <Clapperboard size={25} strokeWidth={2.5} />
          </span>
          <span>
            啪叽
            <span className="brand-en">
              paji<span>®</span>
            </span>
          </span>
        </Link>
        <p className="sidebar-label">你的脑洞，专属片场</p>
        <TabsList className="sidebar-nav" aria-label="主导航">
          <TabsTab value="studio" className="nav-item">
            <Clapperboard size={19} />
            创作片场
            <Sparkles size={15} className="nav-sparkle" />
          </TabsTab>
          <TabsTab value="works" className="nav-item" disabled={busy}>
            <FolderHeart size={19} />
            我的作品<span className="nav-count">0</span>
          </TabsTab>
        </TabsList>
        <div className="sidebar-note">
          <span className="note-star">✦</span>
          <span className="note-tape" />
          <p>
            一点脑洞，
            <br />
            一吨<span>可爱。</span>
          </p>
          <div className="note-doodle">
            <Heart size={22} />
            <span>MAKE IT FUN!</span>
          </div>
        </div>
        <div className="sidebar-bottom">
          <span className="local-dot" />
          <div>
            <strong>灵感就存在这里</strong>
            <p>无须登录，自由创作</p>
          </div>
          <Heart size={16} />
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>我的工作台</span>
            <ChevronRight size={14} />
            <strong>{view === "studio" ? "创作片场" : "我的作品"}</strong>
          </div>
          <div className="topbar-actions">
            <span className="beta-tag">BETA</span>
            <AiSettings value={ai} disabled={busy} onChange={configureAi} />
            <Guide />
            <div className="profile-mark" aria-label="本地创作者">
              <span>p.</span>
            </div>
          </div>
        </header>
        <main id="main-content">
          <TabsPanel value="studio" className="workspace-panel">
            <div className="page-heading">
              <div>
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
                  <span className="heading-spark">✦</span>
                </h1>
                <p>把你的角色捏成会动的表情包。可爱，根本藏不住。</p>
              </div>
              <div className="heading-sticker">
                <span>今日宜</span>
                <strong>放飞脑洞</strong>
                <Sparkles size={17} />
              </div>
            </div>

            <section className="workflow" aria-label="创作流程">
              {steps.map((step, index) => (
                <div
                  key={step.title}
                  className={cn("workflow-step", index === 0 && "current")}
                  aria-current={index === 0 ? "step" : undefined}
                >
                  <span className="step-number">0{index + 1}</span>
                  <step.icon size={19} />
                  <div>
                    <strong>{step.title}</strong>
                    <span>{step.description}</span>
                  </div>
                  {index < steps.length - 1 && (
                    <ChevronRight className="step-arrow" size={17} />
                  )}
                </div>
              ))}
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
                        <ImagePlus size={18} />
                      </span>
                      <h2 id="casting-title">今天，谁来当主角？</h2>
                    </div>
                    <span className="small-label">ACT 01 / 选角</span>
                  </div>
                  <p className="section-description">
                    一张立绘、一个头像，甚至是随手画的小家伙。
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
                      <>
                        <div className="uploaded-image">
                          <Image
                            unoptimized
                            width={108}
                            height={112}
                            src={upload.url}
                            alt="已选择的角色原图"
                            onError={() => {
                              setError("图片无法读取，请换一张有效的角色图。");
                              setUpload(null);
                              setPreviewUpload(false);
                            }}
                          />
                          <span>
                            <Check size={12} />
                            演员已就位
                          </span>
                        </div>
                        <strong className="uploaded-name">{upload.name}</strong>
                        <p>确认定妆前，角色图仅在本地预览。</p>
                        {!previewUpload && (
                          <Button className="button button-secondary" onClick={() => setPreviewUpload(true)}>
                            <MonitorPlay size={16} /> 返回我的演员
                          </Button>
                        )}
                        <Button
                          className="button button-primary"
                          disabled={busy}
                          onClick={() => input.current?.click()}
                        >
                          <Upload size={16} />
                          换一位演员
                        </Button>
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
                          移除图片
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="upload-art" aria-hidden="true">
                          <div className="art-back" />
                          <div className="art-front">
                            <ImagePlus size={34} strokeWidth={1.6} />
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
                          className="button button-primary"
                          onClick={() => input.current?.click()}
                        >
                          <Plus size={18} />
                          选择角色图片
                          <ArrowUpRight size={16} />
                        </Button>
                        <span className="upload-formats">
                          PNG / JPG / WebP<span>·</span>最大 10 MiB
                        </span>
                      </>
                    )}
                  </div>
                  <div className="upload-status" aria-live="polite">
                    {error ? (
                      <p className="error-message">
                        <Info size={14} />
                        {error}
                      </p>
                    ) : (
                      <p>
                        <span className="tiny-lock">
                          <Layers size={13} />
                        </span>
                        选择图片不会上传；开始 AI 定妆前会征求你的同意。
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
                    <span>
                      免上传，直接体验 <ArrowDown size={13} />
                    </span>
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
                        onClick={() => chooseActor(item.id)}
                      >
                        <span className="sample-illustration">
                          <Mascot actor={item.id} miniature playing={false} />
                          <span className="sample-tag">{item.tag}</span>
                          <span className="sample-check">
                            <Check size={12} />
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
                  <span className="director-avatar">
                    <Clapperboard size={21} />
                  </span>
                  <div>
                    <strong>
                      导演的小声提醒<span>DIRECTOR’S NOTE</span>
                    </strong>
                    <p>
                      角色越简单，演技越放飞。毕竟，谁能拒绝一只会发疯的团子呢？
                    </p>
                  </div>
                  <Sparkles size={20} />
                </div>
              </div>

              <section
                className="panel preview-panel"
                aria-labelledby="preview-title"
              >
                <div className="section-heading">
                  <div className="section-title">
                    <span className="section-icon blue">
                      <MonitorPlay size={18} />
                    </span>
                    <h2 id="preview-title">片场偷看</h2>
                  </div>
                  <span className="live-tag">
                    <span />
                    {showModel ? (asset ? "已绑定骨骼" : "加载模型中") : previewUpload ? "本地预览" : "示例预览"}
                  </span>
                </div>
                <div
                  className={cn(
                    "preview-stage",
                    previewUpload && "image-stage",
                  )}
                >
                  <div className="stage-grid" />
                  <span className="stage-corner corner-tl" />
                  <span className="stage-corner corner-tr" />
                  <span className="stage-corner corner-bl" />
                  <span className="stage-corner corner-br" />
                  <span className="stage-label">
                    {showModel ? "PAJI / 3D STAGE" : previewUpload ? "ORIGINAL IMAGE" : "PAJI / LITTLE THEATER"}
                  </span>
                  {showModel && stageGlb ? (
                    <ModelStage
                      blob={stageGlb}
                      rigged
                      skeleton={skeleton}
                      visible={view === 'studio'}
                      onInfo={(blob, info) => load.current?.blob === blob ? load.current.settle(info) : asset?.glb === blob}
                      onError={(blob, failure) => { if (load.current?.blob === blob) load.current.settle(undefined, failure); }}
                    />
                  ) : previewUpload && upload ? (
                    <div className="original-preview">
                      <Image
                        unoptimized
                        width={400}
                        height={400}
                        src={upload.url}
                        alt="上传角色的本地预览"
                      />
                      <span>原图预览 · 确认后开始 AI 定妆</span>
                    </div>
                  ) : (
                    <>
                      <span className="stage-sticker sticker-happy">
                        {mood === "speechless"
                          ? "…"
                          : mood === "crazy"
                            ? "啊啊啊！"
                            : "好耶！"}
                      </span>
                      <span className="stage-spark spark-one">✦</span>
                      <span className="stage-spark spark-two">✧</span>
                      <span className="stage-swirl" />
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
                      <span className="stage-floor-label">100% 可爱浓度</span>
                      <Button
                        className="icon-button play-toggle"
                        onClick={() => setPlaying(!playing)}
                        aria-label={playing ? "暂停预览动画" : "播放预览动画"}
                      >
                        {playing ? (
                          <Pause size={15} fill="currentColor" />
                        ) : (
                          <Play size={15} fill="currentColor" />
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
                        <span>{previewUpload ? "ORIGINAL" : "DEMO ACTOR"}</span>
                      </strong>
                      <p>
                        {previewUpload
                          ? "先看看角色图，期待 TA 的第一次开拍。"
                          : "小小一只，情绪倒是不少。"}
                      </p>
                    </div>
                    <span className="actor-heart">
                      <Heart size={19} />
                    </span>
                  </div>
                  {previewUpload ? (
                    <div className="model-controls">
                      {!asset && !ai && <p>请先在页面顶部的「AI 设置」选择服务和模型。</p>}
                      {!asset && ai && <label><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} /> 我有权使用这张图片，并同意发送给 {ai.baseUrl ? new URL(ai.baseUrl).host : providers[ai.provider].label} 分析。模型和骨骼在本地生成。</label>}
                      {!busy && !asset && <Button className="button button-primary" disabled={!consent || !ai || supported !== true} onClick={() => void generateModel()}>
                        <WandSparkles size={16} /> {status ? "继续定妆" : "生成模型并绑定骨骼"}
                      </Button>}
                      {supported === null && <p>正在检查浏览器是否支持 3D 定妆…</p>}
                      {supported === false && <p className="error-message">当前浏览器不支持 WebAssembly JSPI，请使用最新版 Chrome 或 Safari 27+。</p>}
                      {startedAt !== null ? <>
                        <DressingProgress startedAt={startedAt} status={status} />
                        <Button className="button button-secondary" onClick={() => run.current?.abort()}>停止定妆</Button>
                      </> : status && <p role="status">{status}</p>}
                      {modelError && <p role="alert" className="error-message">{modelError}</p>}
                      {asset && <label><input type="checkbox" checked={skeleton} onChange={(event) => setSkeleton(event.target.checked)} /> 显示骨骼（{asset.bones} 根）</label>}
                      {asset && <a className="button button-secondary" href={asset.download} download="paji-rigged.glb">下载 GLB <ArrowDown size={15} /></a>}
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
                          <MousePointer2 size={13} />
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
                          <strong>
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
                  <WandSparkles size={14} />
                  <span>
                    {previewUpload
                      ? "定妆支持 GLB 下载；GIF 导出仍在筹备中。"
                      : "这是示例动效，你的角色会有自己的戏。"}
                  </span>
                </div>
              </section>
            </div>
            <footer className="workspace-footer">
              <span>
                MADE FOR YOUR WILD IMAGINATION
                <span className="footer-star">✦</span>
              </span>
              <span>一点灵感，无限种可能。</span>
            </footer>
          </TabsPanel>

          <TabsPanel value="works" className="workspace-panel">
            <div className="page-heading">
              <div>
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
              <span className="empty-icon">
                <FolderHeart size={40} strokeWidth={1.4} />
              </span>
              <h2>你的第一部作品，还在脑洞里</h2>
              <p>
                这里将收集你导出的表情包。当前可先在片场体验内置演员，
                <br />
                作品保存和 GIF 导出仍在筹备中。
              </p>
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
