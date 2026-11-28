import { z } from 'zod';

export const portraitToolName = 'direct_gif';
export const portraitPromptLimit = 600;
export const portraitTokenBudget = 6144;
const unit = z.number().min(0).max(1);
const point = z.strictObject({ x: unit, y: unit });
const channels = ['x', 'y', 'tilt', 'squash', 'nod', 'turn', 'headTilt', 'squint', 'gaze', 'blink', 'mouth'] as const;
const effects = ['puff', 'spark', 'sweat', 'heart', 'impact', 'question', 'flame'] as const;
const faceChannels = new Set<string>(['squint', 'gaze', 'blink', 'mouth']);
const nonnegativeChannels = new Set<string>(['squint', 'blink', 'mouth']);
export const isFaceChannel = (channel: string) => faceChannels.has(channel);
const cue = { from: unit, to: unit };

/** Closed, data-only storyboard. All times are fractions of a single loop. */
export const portraitScoreSchema = z.strictObject({
  title: z.string().trim().min(1).max(40),
  duration: z.number().min(1.2).max(3),
  tracks: z.array(z.strictObject({
    channel: z.enum(channels),
    keys: z.array(z.strictObject({
      at: z.number().gt(0).lt(1), value: z.number().min(-1).max(1),
    })).min(1).max(12),
  })).min(1).max(channels.length),
  face: z.strictObject({ leftEye: point, rightEye: point, mouth: point, mouthStyle: z.enum(['open', 'smile', 'hiss']).optional() }).optional(),
  effects: z.array(z.strictObject({
    ...cue, kind: z.enum(effects), anchor: z.enum(['head', 'mouth', 'body']),
    direction: z.enum(['left', 'right', 'up']), strength: unit,
  })).max(6).optional(),
  caption: z.strictObject({ ...cue, text: z.string().trim().min(1).max(20), placement: z.enum(['top', 'bottom', 'side']) }).optional(),
  note: z.string().trim().min(1).max(100).optional(),
}).superRefine((score, ctx) => {
  const used = new Set<string>();
  let movement = false;
  for (const [i, track] of score.tracks.entries()) {
    if (used.has(track.channel)) ctx.addIssue({ code: 'custom', path: ['tracks', i, 'channel'], message: 'Duplicate channel' });
    used.add(track.channel);
    for (const [j, key] of track.keys.entries()) {
      if (key.value !== 0) movement = true;
      if ((j && track.keys[j - 1].at >= key.at) || (nonnegativeChannels.has(track.channel) && key.value < 0)) {
        ctx.addIssue({ code: 'custom', path: ['tracks', i, 'keys', j], message: 'Keys must be sorted and face values nonnegative' });
      }
    }
  }
  if (!movement) ctx.addIssue({ code: 'custom', path: ['tracks'], message: 'At least one nonzero motion key required' });
  for (const [i, effect] of (score.effects ?? []).entries()) {
    if (effect.from >= effect.to || (effect.anchor === 'mouth' && !score.face)) {
      ctx.addIssue({ code: 'custom', path: ['effects', i], message: 'Invalid cue or missing mouth anchor' });
    }
  }
  if (score.caption && score.caption.from >= score.caption.to) ctx.addIssue({ code: 'custom', path: ['caption'], message: 'Invalid interval' });
  const face = score.face;
  if ((!face && [...used].some(isFaceChannel)) || (face && (
    face.rightEye.x - face.leftEye.x < 0.055 || face.rightEye.x - face.leftEye.x > 0.55 ||
    Math.abs(face.leftEye.y - face.rightEye.y) > 0.17 ||
    face.mouth.y <= Math.min(face.leftEye.y, face.rightEye.y) || face.mouth.y - Math.max(face.leftEye.y, face.rightEye.y) > 0.33 ||
    face.mouth.x < face.leftEye.x - 0.13 || face.mouth.x > face.rightEye.x + 0.13
  ))) ctx.addIssue({ code: 'custom', path: ['face'], message: 'Anchor the eyes and mouth on the supplied portrait' });
});

const { $schema: _schema, ...toolSchema } = z.toJSONSchema(portraitScoreSchema, { io: 'input' });
void _schema;
export const portraitScoreToolSchema = toolSchema;
export type PortraitScore = z.infer<typeof portraitScoreSchema>;
export type PortraitPose = Record<typeof channels[number], number>;
export const restPose: Readonly<PortraitPose> = Object.freeze({ x: 0, y: 0, tilt: 0, squash: 0, nod: 0, turn: 0, headTilt: 0, squint: 0, gaze: 0, blink: 0, mouth: 0 });

/** Independent channels compose; implicit neutral endpoints make the loop close. */
export function evaluatePortrait(score: PortraitScore | null, seconds: number) {
  const pose = { ...restPose };
  if (!score || !Number.isFinite(seconds)) return { pose, effects: [], caption: undefined };
  const ratio = seconds / score.duration;
  const t = ratio - Math.floor(ratio);
  for (const track of score.tracks) {
    const next = track.keys.findIndex(key => key.at >= t);
    const a = (next < 0 ? track.keys.at(-1) : track.keys[next - 1]) ?? { at: 0, value: 0 };
    const b = (next < 0 ? undefined : track.keys[next]) ?? { at: 1, value: 0 };
    const f = (t - a.at) / (b.at - a.at);
    const eased = f * f * (3 - 2 * f);
    pose[track.channel] = a.value + (b.value - a.value) * eased;
  }
  const effects = (score.effects ?? []).flatMap((effect, index) => t >= effect.from && t < effect.to && t > 0
    ? [{ ...effect, index, progress: (t - effect.from) / (effect.to - effect.from) }] : []);
  const caption = score.caption && t > 0 && t >= score.caption.from && t < score.caption.to
    ? { ...score.caption, progress: (t - score.caption.from) / (score.caption.to - score.caption.from) } : undefined;
  return { pose, effects, caption };
}
