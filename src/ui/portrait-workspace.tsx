'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@ui-sdk/react/button';
import { ArrowDown, ImageIcon, Play, Pause, Sparkles } from 'lucide-react';
import Image from 'next/image';
import { preparePortrait, type PortraitImage } from '@/model/portrait-image';
import { portraitPromptLimit, type PortraitScore } from '@/score/portrait';
import { providers, type DirectorSettings } from '@/director/settings';
import { createPortraitRenderer } from '@/stage/portrait-renderer';
import { PortraitMaskEditor } from './portrait-mask-editor';

async function photograph(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
    if (value) resolve(value);
    else reject(new Error('无法为 AI 导演读取原画。'));
  }, 'image/png'));
  return new File([blob], 'portrait.png', { type: 'image/png' });
}

type Phase = 'mask' | 'score' | 'gif';
const phaseText = { mask: '正在本机准备原画…', score: 'AI 导演正在编排动作谱…', gif: '正在取帧并编码 GIF…' };

export function PortraitWorkspace({ file, url, visible, ai, onOpenAi, onProgress, onBusy }: {
  file: File; url: string; visible: boolean; ai: DirectorSettings | null;
  onOpenAi: (button: HTMLElement) => void;
  onProgress: (stage: 'ready' | 'performed' | 'exported') => void;
  onBusy: (busy: boolean) => void;
}) {
  const [portrait, setPortrait] = useState<PortraitImage | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [score, setScore] = useState<PortraitScore | null>(null);
  const [prompt, setPrompt] = useState('');
  const [approval, setApproval] = useState<DirectorSettings | null>(null);
  const approved = ai !== null && approval === ai;
  const [neck, setNeck] = useState(50);
  const [playing, setPlaying] = useState(true);
  const [original, setOriginal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [gif, setGif] = useState<{ url: string; size: number; bytes: number } | null>(null);
  const active = useRef<AbortController | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<ReturnType<typeof createPortraitRenderer> | null>(null);
  const playback = useRef(false);
  const refresh = useRef<((reset?: boolean) => void) | null>(null);
  const config = useRef<{ neck: number; score: PortraitScore | null }>({ neck: 50, score: null });

  useEffect(() => {
    playback.current = Boolean(score && playing && visible && !original && !editing);
    refresh.current?.();
  }, [editing, original, playing, score, visible]);
  useEffect(() => {
    config.current = { neck, score };
    try { player.current?.configure(neck / 100, score); player.current?.draw(0); refresh.current?.(true); }
    catch { queueMicrotask(() => setPreviewError('原画预览已中断，请检查浏览器的 WebGL 支持。')); }
  }, [neck, score]);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  useEffect(() => () => { if (gif) URL.revokeObjectURL(gif.url); }, [gif]);
  useEffect(() => {
    if (!portrait || !host.current) return;
    const element = host.current;
    let renderer: ReturnType<typeof createPortraitRenderer> | undefined;
    let frame = 0, last = 0, elapsed = 0;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    function animate(now: number) {
      if (!playback.current || !renderer) return;
      elapsed = (elapsed + (last ? Math.min(50, now - last) : 0) / 1000) % renderer.duration;
      try { renderer.draw(elapsed); }
      catch { setPreviewError('原画预览已中断，请检查浏览器的 WebGL 支持。'); return; }
      last = now;
      frame = requestAnimationFrame(animate);
    }
    function sync(reset = false) {
      cancelAnimationFrame(frame);
      last = 0;
      if (reset) elapsed = 0;
      if (!motionPreference.matches && playback.current) frame = requestAnimationFrame(animate);
      else if (motionPreference.matches) {
        elapsed = 0;
        try { renderer?.draw(0); } catch { setPreviewError('原画预览已中断。'); }
      }
    }
    const onPreference = () => sync();
    const lost = () => {
      cancelAnimationFrame(frame);
      setPreviewError('原画预览暂时不可用，请检查浏览器的 WebGL 支持。');
    };
    try {
      renderer = createPortraitRenderer(portrait.canvas, config.current.neck / 100, config.current.score, 480);
      player.current = renderer; refresh.current = sync;
      renderer.canvas.setAttribute('role', 'img');
      renderer.canvas.setAttribute('aria-label', '透明底原画演出预览');
      renderer.canvas.addEventListener('webglcontextlost', lost);
      element.append(renderer.canvas); renderer.draw(0);
      motionPreference.addEventListener('change', onPreference);
      sync();
    } catch {
      renderer?.dispose(); player.current = null; refresh.current = null;
      queueMicrotask(() => setPreviewError('当前浏览器无法启动原画预览，请检查 WebGL 支持。'));
      return;
    }
    return () => {
      cancelAnimationFrame(frame);
      motionPreference.removeEventListener('change', onPreference);
      renderer?.canvas.removeEventListener('webglcontextlost', lost);
      renderer?.dispose(); player.current = null; refresh.current = null;
    };
  }, [portrait]);

  async function run(next: Phase) {
    if (active.current || (next === 'gif' && (!portrait || !score)) ||
      (next === 'score' && (!portrait || !ai || !approved || !prompt.trim()))) return;
    const operation = new AbortController();
    const { signal } = operation;
    active.current = operation;
    onBusy(true); setPhase(next); setError('');
    try {
      if (next === 'mask') {
        const result = await preparePortrait(file, signal);
        signal.throwIfAborted();
        setPreviewError(''); setPortrait(result); setOriginal(false); onProgress('ready');
      } else if (next === 'score' && portrait && ai) {
        const { DirectorRuntime } = await import('@/director/runtime');
        const shot = await photograph(portrait.canvas);
        signal.throwIfAborted();
        const take = await new DirectorRuntime(ai).perform(shot, prompt, signal);
        signal.throwIfAborted();
        setScore(take); setGif(null); setPlaying(true); setOriginal(false); setPreviewError(''); onProgress('performed');
      } else if (portrait && score) {
        const { exportGif } = await import('@/export');
        const result = await exportGif(portrait.canvas, neck / 100, score, signal);
        signal.throwIfAborted();
        setGif({ url: URL.createObjectURL(result.blob), size: result.size, bytes: result.blob.size });
        onProgress('exported');
      }
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : '制作失败，请重试。');
    } finally {
      if (active.current === operation) { active.current = null; setPhase(null); onBusy(false); }
    }
  }

  return <>
    <div hidden={editing}>
      <div className="preview-stage image-stage portrait-stage">
        <div className="stage-grid" aria-hidden="true" />
        <span className="stage-label">{portrait && !original ? 'PAJI / ORIGINAL PORTRAIT' : 'ORIGINAL IMAGE'}</span>
        {portrait && <div className="portrait-canvas" ref={host} hidden={original} />}
        {(!portrait || original) && <div className="original-preview"><div className="original-frame">
          <Image unoptimized width={400} height={400} src={url} alt="上传角色的本地预览" />
        </div></div>}
        {score && !original && <Button className="icon-button play-toggle" aria-label={playing ? '暂停原画动画' : '播放原画动画'} onClick={() => setPlaying(!playing)}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </Button>}
      </div>
      <div className="preview-controls portrait-controls">
        <div className="preview-actor-row"><div>
          <strong>原画开拍<span>2.5D</span></strong>
          <p>{portrait ? '保留原画细节，按你的指令编排近正面演出。' : '先在本机去背景。定妆不会上传图片；只有确认开拍才会发送透明图和指令。'}</p>
        </div></div>
        {!portrait && <Button className="button button-primary" disabled={phase !== null} onClick={() => void run('mask')}>
          <Sparkles size={16} /> 本机定妆
        </Button>}
        {portrait && <>
          <form className="portrait-direct" onSubmit={event => { event.preventDefault(); void run('score'); }}>
            <label htmlFor="portrait-direction">ACT 03 · 想让 TA 怎么演？</label>
            <textarea id="portrait-direction" value={prompt} maxLength={portraitPromptLimit} rows={3} disabled={phase !== null}
              placeholder="例如：先低头憋气，再眯眼露小尖牙哈一声，气流往右，最后装作若无其事。"
              onChange={event => setPrompt(event.target.value)} />
            {ai ? <label className="consent-card">
              <input type="checkbox" checked={approved} disabled={phase !== null} onChange={event => setApproval(event.target.checked ? ai : null)} />
              <span>我同意将定妆后的透明角色图和开拍指令发送给 <strong>{ai.baseUrl ? new URL(ai.baseUrl).host : providers[ai.provider].label}</strong> 编排动作。渲染和导出仍在本机。</span>
            </label> : <Button type="button" className="button button-secondary" onClick={event => onOpenAi(event.currentTarget)}>配置 AI 导演</Button>}
            <Button type="submit" className="button button-primary" disabled={phase !== null || !approved || !prompt.trim()}>
              <Sparkles size={15} /> {score ? '按指令重新开拍' : '按指令生成演出'}
            </Button>
          </form>
          {score && <div className="portrait-take" role="status"><strong>已开拍：{score.title}</strong> · {score.duration.toFixed(1)} 秒
            {score.note && <p>{score.note}</p>}
          </div>}
          {score && <label className="portrait-field">动作重心 <span>{neck}%</span>
            <input type="range" min={25} max={75} value={neck} step={5} disabled={phase !== null} onChange={event => {
              setNeck(Number(event.target.value)); setGif(null); onProgress('performed');
            }} />
          </label>}
          <div className="portrait-actions">
            <Button className="button button-secondary" onClick={() => setOriginal(!original)}>
              <ImageIcon size={15} /> {original ? '返回舞台' : '对照原图'}
            </Button>
            {portrait.source === 'segmentation' && <Button className="button button-secondary" disabled={phase !== null} onClick={() => setEditing(true)}>修边</Button>}
            {score && <Button className="button button-primary" disabled={phase !== null} onClick={() => void run('gif')}>
              <ArrowDown size={15} /> 制作透明 GIF
            </Button>}
          </div>
          {gif && <a className="button button-secondary" download="paji-portrait.gif" href={gif.url}>
            下载 GIF · {gif.size} px · {Math.ceil(gif.bytes / 1024)} KiB <ArrowDown size={15} />
          </a>}
        </>}
        {phase && <p role="status" className="model-status-pill">{phaseText[phase]}</p>}
        {phase && <Button className="button button-secondary" onClick={() => active.current?.abort()}>取消</Button>}
        {(error || previewError) && <p role="alert" className="form-alert">{error || previewError}</p>}
      </div>
      <div className="preview-footer"><Sparkles size={14} aria-hidden="true" /><span>
        {portrait?.source === 'segmentation' ? '自动抠图可能残留发缝或误删细节，开拍前可修边。' : '定妆与 GIF 编码在本机完成。'}
      </span></div>
    </div>
    {editing && portrait && <PortraitMaskEditor image={portrait} onCancel={() => setEditing(false)} onApply={canvas => {
      setPortrait({ ...portrait, canvas }); setEditing(false); setOriginal(false); setPreviewError('');
      setScore(null); setGif(null); setApproval(null); onProgress('ready');
    }} />}
  </>;
}
