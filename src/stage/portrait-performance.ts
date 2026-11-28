import type { evaluatePortrait, PortraitScore } from '@/score/portrait';

type Face = NonNullable<PortraitScore['face']>;
type Frame = ReturnType<typeof evaluatePortrait>;
const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Modify only bounded eye/mouth patches, leaving the rest of the original texture untouched. */
export function createFacePainter(source: HTMLCanvasElement, face: Face) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 720 / Math.max(source.width, source.height));
  const width = canvas.width = Math.max(1, Math.round(source.width * scale));
  const height = canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法渲染局部表情。');
  ctx.drawImage(source, 0, 0, width, height);
  const base = ctx.getImageData(0, 0, width, height), frame = ctx.createImageData(width, height);
  const span = (face.rightEye.x - face.leftEye.x) * width;
  const rx = Math.max(2, span * 0.41);
  // Avoid drawing the brim or bangs into the eyes: reserve more room below than above.
  const ryUp = Math.max(2, Math.min(height * 0.055, span * 0.24));
  const ryDown = Math.max(2, Math.min(height * 0.09, span * 0.37));
  const eyes = [face.leftEye, face.rightEye].map((point, index) => {
    const x = point.x * width, y = point.y * height;
    const inner = index ? -1 : 1;
    const samples: number[][] = [[], [], []];
    // Infer the eyelid color from the nearby cheek on this actor, not from a global skin-color guess.
    for (const inward of [0.04, 0.24, 0.42]) for (const below of [.84, 1.0, 1.12]) {
      const u = Math.round(x + inner * rx * inward), v = Math.round(y + ryDown * below);
      if (u < 0 || u >= width || v < 0 || v >= height) continue;
      const at = (v * width + u) * 4;
      if (base.data[at + 3] < 230) continue;
      for (let i = 0; i < 3; i++) samples[i].push(base.data[at + i]);
    }
    const lidColor = samples[0].length >= 3 ? samples.map(channel => channel.sort((a, b) => a - b)[channel.length >> 1]) : null;
    return { x, y, tilt: inner * 0.16, lidColor };
  });
  let lastEyes = 0, lastGaze = 0, lastBlink = 0, lastMouth = 0;
  return {
    canvas,
    draw(squint: number, gaze: number, blink: number, jaw: number) {
      if (lastEyes === squint && lastGaze === gaze && lastBlink === blink && lastMouth === jaw) return false;
      lastEyes = squint; lastGaze = gaze; lastBlink = blink; lastMouth = jaw;
      frame.data.set(base.data);
      if (squint > 0.015 || Math.abs(gaze) > 0.015 || blink > 0.015) {
        for (const eye of eyes) {
          const top = Math.max(0, Math.ceil(eye.y - ryUp)), bottom = Math.min(height - 1, Math.floor(eye.y + ryDown));
          const left = Math.max(0, Math.ceil(eye.x - rx)), right = Math.min(width - 1, Math.floor(eye.x + rx));
          for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
            const dx = x - eye.x, dy = y - eye.y;
            const wx = 1 - Math.abs(dx) / rx, wy = 1 - Math.abs(dy) / (dy < 0 ? ryUp : ryDown);
            const weight = ease(wx * 1.9) * ease(wy * 1.8);
            const squeeze = Math.max(0.37, 1 - (0.52 * squint + (eye.lidColor ? 0.22 : 0.35) * blink) * weight);
            const core = ease(wx * 1.45) * ease(wy * 1.3);
            const sx = Math.min(right, Math.max(left, x - gaze * span * 0.15 * core));
            const sy = Math.min(bottom, Math.max(top, eye.y + (dy - (eye.tilt * dx * squint + blink * ryDown * 0.12) * weight) / squeeze));
            const x0 = Math.floor(sx), x1 = Math.min(right, x0 + 1), tx = sx - x0;
            const y0 = Math.floor(sy), y1 = Math.min(bottom, y0 + 1), ty = sy - y0;
            const a = (y0 * width + x0) * 4, b = (y0 * width + x1) * 4;
            const c = (y1 * width + x0) * 4, d = (y1 * width + x1) * 4, dest = (y * width + x) * 4;
            // Keep the original silhouette: never sample transparent pixels into the visible layer.
            if (base.data[dest + 3] < 128 || base.data[a + 3] < 128 || base.data[b + 3] < 128 || base.data[c + 3] < 128 || base.data[d + 3] < 128) continue;
            const heightSpan = dy < 0 ? ryUp : ryDown * 0.81;
            const radius = Math.hypot(dx / (rx * 1.10), dy / heightSpan);
            // Compress gently while sweeping a feathered lid down. Hard-clamping the warp
            // at a near-zero scale would repeat the dark top row into a black band.
            const closure = eye.lidColor ? ease((blink - 0.12) / 0.73) * ease((1 - radius) * 5.2) *
              ease((ryDown * (blink * 1.5 - .71) - dy) / (ryDown * .31)) : 0;
            for (let i = 0; i < 3; i++) {
              const upper = base.data[a + i] * (1 - tx) + base.data[b + i] * tx;
              const lower = base.data[c + i] * (1 - tx) + base.data[d + i] * tx;
              const warped = upper * (1 - ty) + lower * ty;
              const lid = eye.lidColor ? eye.lidColor[i] - 7 * Math.max(0, -dy / ryUp) : warped;
              frame.data[dest + i] = warped * (1 - closure) + lid * closure;
            }
          }
        }
      }
      ctx.putImageData(frame, 0, 0);
      if (blink > 0.7) {
        ctx.save(); ctx.globalCompositeOperation = 'source-atop';
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(1, span * 0.019); ctx.globalAlpha = ease((blink - 0.7) / 0.3) * 0.88;
        for (const eye of eyes) {
          const light = (eye.lidColor?.reduce((sum, color) => sum + color, 0) ?? 300) / 3;
          ctx.strokeStyle = light > 82 ? '#352b42' : '#bbaec9';
          const lid = eye.y + ryDown * 0.18;
          ctx.beginPath(); ctx.moveTo(eye.x - rx * .6, lid);
          ctx.quadraticCurveTo(eye.x, lid + ryDown * .11, eye.x + rx * .6, lid); ctx.stroke();
        }
        ctx.restore();
      }
      if (jaw > 0.025) {
        const smile = face.mouthStyle === 'smile';
        const w = span * (0.18 + (smile ? 0.58 : 0.44) * jaw), h = span * (0.06 + (smile ? 0.25 : 0.35) * jaw);
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = ease(jaw * 4);
        ctx.translate(face.mouth.x * width, face.mouth.y * height + h * 0.1);
        ctx.beginPath(); ctx.moveTo(-w * 0.5, -h * 0.035);
        ctx.bezierCurveTo(-w * 0.43, -h * 0.52, w * 0.44, -h * 0.52, w * 0.5, -h * 0.035);
        ctx.bezierCurveTo(w * 0.44, h * 0.69, -w * 0.43, h * 0.69, -w * 0.5, -h * 0.035); ctx.closePath();
        ctx.fillStyle = '#432b45'; ctx.fill(); ctx.strokeStyle = '#301e34'; ctx.lineWidth = Math.max(0.7, w * 0.045); ctx.stroke();
        ctx.clip();
        ctx.fillStyle = '#c16d83'; ctx.beginPath(); ctx.ellipse(0, h * 0.48, w * 0.32, h * 0.18, 0, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = '#fff6e8';
        if (face.mouthStyle === 'hiss') {
          ctx.beginPath();
          ctx.moveTo(-w * .41, -h * .34); ctx.lineTo(-w * .13, -h * .44); ctx.lineTo(-w * .23, h * .07);
          ctx.moveTo(w * .41, -h * .34); ctx.lineTo(w * .13, -h * .44); ctx.lineTo(w * .23, h * .07); ctx.fill();
        } else if (smile && jaw > 0.53) ctx.fillRect(-w / 2, -h / 2, w, h * .43);
        ctx.restore();
      }
      return true;
    },
  };
}

function paintAccent(ctx: CanvasRenderingContext2D, cue: Frame['effects'][number], x: number, y: number, opacity: number) {
  const { kind, direction, progress: p, strength, index } = cue;
  if (kind !== 'question' && kind !== 'flame') return false;
  const side = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
  const bound = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  ctx.save(); ctx.globalAlpha = opacity;
  if (kind === 'question') {
    const dx = side * (73 + strength * 18);
    const dy = side ? -5 : -42;
    ctx.translate(bound(x + dx + 3 * Math.sin(p * 8), 20, 340), bound(y + dy - 8 * p, 22, 334));
    ctx.rotate(side * 0.16 + Math.sin(p * 7) * 0.08);
    const scale = 0.78 + 0.22 * ease(p * 7);
    ctx.scale(scale, scale);
    ctx.font = `900 ${Math.round(23 + strength * 18)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = '#fff7ff'; ctx.strokeText('?', 0, 0);
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#3a2b51'; ctx.strokeText('?', 0, 0);
    ctx.fillStyle = '#ad81ec'; ctx.fillText('?', 0, 0);
  } else {
    // Anchor near the lower sides of the actor, with a stationary base and a flickering tip.
    const sideOfFlame = side || (index % 2 ? -1 : 1);
    const dx = sideOfFlame * (side ? 111 : 74);
    ctx.translate(bound(x + dx, 30, 330), bound(y + (side ? 67 : 97), 60, 326));
    const height = (25 + strength * 33) * (0.94 + 0.09 * Math.sin(p * 41 + index));
    const w = (12 + strength * 10) * (side ? 1 : 0.72);
    const tip = Math.sin(p * 31 + index) * w * .43;
    const outer = ctx.createLinearGradient(0, -height, 0, 1);
    outer.addColorStop(0, '#ffd16c'); outer.addColorStop(0.56, '#ff8b55'); outer.addColorStop(1, '#df5272');
    ctx.beginPath(); ctx.moveTo(-w * .75, 0);
    ctx.bezierCurveTo(-w * 1.25, -height * .23, -w * .2, -height * .50, tip, -height);
    ctx.bezierCurveTo(tip + w * .18, -height * .69, w * 1.33, -height * .55, w * .81, -height * .29);
    ctx.quadraticCurveTo(w * 1.13, -height * .17, w * .74, 0); ctx.closePath();
    ctx.fillStyle = outer; ctx.fill(); ctx.strokeStyle = '#fff0bf'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-w * .32, -1);
    ctx.quadraticCurveTo(-w * .53, -height * .22, tip * .32, -height * .56);
    ctx.quadraticCurveTo(w * .59, -height * .19, w * .35, -1); ctx.closePath();
    ctx.fillStyle = '#ffe7a1'; ctx.fill();
  }
  ctx.restore();
  return true;
}

/** Graphic effects are deterministic, local, and attach to points on the animated mesh. */
export function paintPerformance(ctx: CanvasRenderingContext2D, size: number, frame: Frame,
  locate: (anchor: 'head' | 'mouth' | 'body') => { x: number; y: number }) {
  ctx.save(); ctx.scale(size / 360, size / 360); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const effect of frame.effects) {
    const p = effect.progress, strength = effect.strength;
    if (!strength) continue;
    const origin = locate(effect.anchor);
    const x = origin.x * 360, y = origin.y * 360;
    const angle = effect.direction === 'up' ? -Math.PI / 2 : effect.direction === 'left' ? Math.PI : 0;
    const opacity = ease(p * 7) * ease((1 - p) * 3);
    if (paintAccent(ctx, effect, x, y, opacity)) continue;
    const burst = effect.kind === 'puff' || effect.kind === 'impact';
    for (let i = 0; i < (burst ? 4 : 3); i++) {
      const a = angle + (i - 1.5) * 0.27;
      const distance = burst ? 12 + (22 + 40 * strength) * p + i * 8 : 22 + strength * 19 + p * 9 + i * 8;
      ctx.save(); ctx.globalAlpha = opacity * (0.72 + strength * 0.28);
      ctx.translate(x + Math.cos(a) * distance, y + Math.sin(a) * distance);
      const r = 3 + strength * 5;
      ctx.beginPath();
      if (effect.kind === 'puff' || effect.kind === 'impact') {
        ctx.rotate(a); ctx.moveTo(-r * 1.2, 0); ctx.quadraticCurveTo(r * .4, -r * .45, r * 1.75, -r * .1);
        ctx.strokeStyle = effect.kind === 'puff' ? '#a8c7dc' : '#8255a3'; ctx.lineWidth = 4; ctx.stroke();
        ctx.strokeStyle = '#fff7ff'; ctx.lineWidth = 1.7; ctx.stroke();
      } else {
        if (effect.kind === 'heart') {
          ctx.moveTo(0, r); ctx.bezierCurveTo(-r * 2, -r * .5, -r * .35, -r * 1.5, 0, -r * .52);
          ctx.bezierCurveTo(r * .35, -r * 1.5, r * 2, -r * .5, 0, r); ctx.fillStyle = '#ed81af';
        } else if (effect.kind === 'sweat') {
          ctx.moveTo(0, -r * 1.65); ctx.bezierCurveTo(r * 1.7, r, -r * 1.7, r, 0, -r * 1.65); ctx.fillStyle = '#85cfef';
        } else {
          ctx.moveTo(0, -r); ctx.lineTo(r * .32, -r * .31); ctx.lineTo(r, 0); ctx.lineTo(r * .32, r * .31);
          ctx.lineTo(0, r); ctx.lineTo(-r * .32, r * .31); ctx.lineTo(-r, 0); ctx.lineTo(-r * .32, -r * .31); ctx.fillStyle = '#ffdd72';
        }
        ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#fff7ff'; ctx.lineWidth = 1.25; ctx.stroke();
      }
      ctx.restore();
    }
  }
  if (frame.caption) {
    const { text, placement, progress } = frame.caption;
    ctx.globalAlpha = ease(progress * 9) * ease((1 - progress) * 6);
    ctx.font = '900 27px "PingFang SC", system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    const side = placement === 'side', x = side ? 274 : 180, y = placement === 'bottom' ? 314 : side ? 117 : 43;
    const maxWidth = side ? 146 : 310;
    ctx.strokeStyle = '#fff9fc'; ctx.lineWidth = 8; ctx.strokeText(text, x, y, maxWidth);
    ctx.strokeStyle = '#302747'; ctx.lineWidth = 3; ctx.strokeText(text, x, y, maxWidth);
    ctx.fillStyle = '#67529b'; ctx.fillText(text, x, y, maxWidth);
  }
  ctx.restore();
}
