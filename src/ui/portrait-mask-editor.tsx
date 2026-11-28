'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from '@ui-sdk/react/button';
import { measureAlpha } from '@/model/portrait-alpha';
import type { PortraitImage } from '@/model/portrait-image';

type Point = { x: number; y: number };

export function PortraitMaskEditor({ image, onApply, onCancel }: {
  image: PortraitImage; onApply: (canvas: HTMLCanvasElement) => void; onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const previous = useRef<Point | null>(null);
  const undo = useRef<ImageData | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [brush, setBrush] = useState<'restore' | 'erase'>('restore');
  const [size, setSize] = useState(3);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState<Point | null>(null);
  const { width, height } = image.canvas;
  const radius = Math.max(2, Math.min(width, height) * size / 100);

  useEffect(() => { canvas.current?.getContext('2d')?.drawImage(image.canvas, 0, 0); }, [image]);

  function position(event: PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(box.width / width, box.height / height);
    const x = (event.clientX - box.left - (box.width - width * scale) / 2) / scale;
    const y = (event.clientY - box.top - (box.height - height * scale) / 2) / scale;
    return x >= 0 && x <= width && y >= 0 && y <= height ? { x, y } : null;
  }

  function paint(from: Point, to: Point, start: boolean) {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    if (start) { undo.current = ctx.getImageData(0, 0, width, height); setCanUndo(true); setError(''); }
    const count = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / radius));
    ctx.save();
    ctx.beginPath();
    for (let i = 1; i <= count; i++) {
      const x = from.x + (to.x - from.x) * i / count, y = from.y + (to.y - from.y) * i / count;
      ctx.moveTo(x + radius, y); ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
    ctx.clip();
    ctx.clearRect(0, 0, width, height);
    if (brush === 'restore') ctx.drawImage(image.original, 0, 0);
    ctx.restore();
  }

  function keys(event: KeyboardEvent<HTMLCanvasElement>) {
    const base = cursor ?? { x: width / 2, y: height / 2 };
    const step = event.shiftKey ? radius * 2 : radius / 2;
    let next = base;
    switch (event.key) {
      case 'ArrowLeft': next = { ...base, x: Math.max(0, base.x - step) }; break;
      case 'ArrowRight': next = { ...base, x: Math.min(width, base.x + step) }; break;
      case 'ArrowUp': next = { ...base, y: Math.max(0, base.y - step) }; break;
      case 'ArrowDown': next = { ...base, y: Math.min(height, base.y + step) }; break;
      case ' ': case 'Enter': paint(base, base, true); break;
      default: return;
    }
    setCursor(next); event.preventDefault();
  }

  function apply() {
    const edited = canvas.current;
    const context = edited?.getContext('2d');
    if (!edited || !context) return;
    if (measureAlpha(context.getImageData(0, 0, width, height).data, width, height).coverage < 0.005) {
      setError('画面里没有可见的角色。先恢复一点原图再应用。'); return;
    }
    // Own the corrected texture independently of the editor's DOM canvas.
    const result = document.createElement('canvas');
    result.width = width; result.height = height;
    result.getContext('2d')?.drawImage(edited, 0, 0);
    onApply(result);
  }

  return <>
    <div className="preview-stage portrait-mask-stage">
      <div className="portrait-mask-surface" style={{ width: `min(100cqw, ${100 * width / height}cqh)`, aspectRatio: `${width} / ${height}` }}>
        <canvas ref={canvas} width={width} height={height} tabIndex={0} role="img" aria-label="抠图画笔画布，方向键移动，空格下笔"
          onKeyDown={keys}
          onPointerDown={event => {
            if (event.button !== 0 || previous.current) return;
            const point = position(event);
            if (!point) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            previous.current = point; setCursor(point); paint(point, point, true);
          }}
          onPointerMove={event => {
            const point = position(event);
            if (!point) return;
            setCursor(point);
            if (event.currentTarget.hasPointerCapture(event.pointerId) && previous.current) {
              paint(previous.current, point, false); previous.current = point;
            }
          }}
          onLostPointerCapture={() => { previous.current = null; }} />
        {cursor && <span aria-hidden="true" className="portrait-brush-cursor" style={{
          left: `${100 * cursor.x / width}%`, top: `${100 * cursor.y / height}%`, width: `${200 * radius / width}%`, height: `${200 * radius / height}%`,
        }} />}
      </div>
    </div>
    <div className="preview-controls portrait-controls">
      <p className="model-meta-note">点或拖动来恢复误删的像素，或擦除残留背景。也可用方向键移动、空格下笔。</p>
      <div className="portrait-actions portrait-mask-actions" role="group" aria-label="抠图画笔">
        <Button className="button button-secondary" aria-pressed={brush === 'restore'} onClick={() => setBrush('restore')}>恢复原图</Button>
        <Button className="button button-secondary" aria-pressed={brush === 'erase'} onClick={() => setBrush('erase')}>擦除背景</Button>
        <label className="portrait-field">笔粗 <select value={size} onChange={event => setSize(Number(event.target.value))}>
          <option value={1.5}>细</option><option value={3}>中</option><option value={6}>粗</option>
        </select></label>
      </div>
      <div className="portrait-actions">
        <Button className="button button-secondary" disabled={!canUndo} onClick={() => {
          if (undo.current) canvas.current?.getContext('2d')?.putImageData(undo.current, 0, 0);
          undo.current = null; setCanUndo(false); setError('');
        }}>撤销上一笔</Button>
        <Button className="button button-secondary" onClick={onCancel}>放弃修边</Button>
        <Button className="button button-primary" onClick={apply}>应用修边</Button>
      </div>
      {error && <p className="form-alert" role="alert">{error}</p>}
    </div>
  </>;
}
