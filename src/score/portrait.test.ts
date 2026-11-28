import { expect, it } from 'vitest';
import { evaluatePortrait, portraitScoreSchema, restPose } from './portrait';
import { portraitFrameSchedule } from './portrait-timing';

const testScore = {
  title: '先憋气再哈气', duration: 2.4,
  face: { leftEye: { x: .36, y: .39 }, rightEye: { x: .62, y: .40 }, mouth: { x: .50, y: .49 }, mouthStyle: 'hiss' },
  tracks: [
    { channel: 'y', keys: [{ at: .2, value: -.5 }, { at: .5, value: .6 }, { at: .83, value: 0 }] },
    { channel: 'mouth', keys: [{ at: .25, value: 0 }, { at: .5, value: 1 }, { at: .7, value: 0 }] },
  ],
  effects: [{ kind: 'puff', anchor: 'mouth', direction: 'right', from: .35, to: .7, strength: .8 }],
  caption: { from: .38, to: .61, text: '哈！', placement: 'side' },
};

it('composes independent generated tracks and timed cues, closing to neutral at the loop seam', () => {
  const score = portraitScoreSchema.parse(testScore);
  expect(evaluatePortrait(score, 0)).toEqual({ pose: restPose, effects: [], caption: undefined });
  expect(evaluatePortrait(score, score.duration)).toEqual(evaluatePortrait(score, 0));
  expect(evaluatePortrait(score, .2 * score.duration).pose.y).toBeCloseTo(-.5);
  expect(evaluatePortrait(score, .1 * score.duration).pose.y).toBeCloseTo(-.25);
  const hit = evaluatePortrait(score, .5 * score.duration);
  expect(hit.pose).toMatchObject({ mouth: 1, squash: 0 });
  expect(hit.pose.y).toBeCloseTo(.6);
  expect(hit.effects).toMatchObject([{ kind: 'puff', direction: 'right', anchor: 'mouth' }]);
  expect(hit.caption?.text).toBe('哈！');
  expect(evaluatePortrait(score, score.duration * .95).effects).toEqual([]);
  expect(evaluatePortrait(score, score.duration - .001).pose.y).toBeCloseTo(0);
});

it('rejects executable fields, ambiguous or unsorted keys, out-of-bounds tracks, and missing face anchors', () => {
  const good = portraitScoreSchema.parse(testScore);
  for (const bad of [
    { ...good, duration: 999 }, { ...good, code: 'return arbitraryJS' },
    { ...good, tracks: [good.tracks[0], good.tracks[0]] },
    { ...good, tracks: [{ channel: 'x', keys: [{ at: 1, value: 1 }] }] },
    { ...good, tracks: [{ channel: 'x', keys: [{ at: .5, value: 1 }, { at: .4, value: 0 }] }] },
    { ...good, tracks: [{ channel: 'x', keys: [{ at: .5, value: 99 }] }] },
    { ...good, face: undefined }, { ...good, face: { ...good.face, mouth: { x: .5, y: .1 } } },
    { ...good, caption: { ...good.caption, from: .7, to: .2 } },
    { ...good, tracks: [{ channel: 'blink', keys: [{ at: .5, value: -.6 }] }] },
    { ...good, face: undefined, effects: [], tracks: [{ channel: 'gaze', keys: [{ at: .5, value: -.8 }] }] },
  ]) expect(portraitScoreSchema.safeParse(bad).success).toBe(false);
});

it('holds a sideways gaze independently of head movement and keeps question cues timed', () => {
  const score = portraitScoreSchema.parse({ ...testScore, tracks: [
    { channel: 'gaze', keys: [{ at: .32, value: .9 }, { at: .75, value: .9 }] },
  ], effects: [{ kind: 'question', anchor: 'head', direction: 'right', strength: .7, from: .33, to: .66 }] });
  const at = evaluatePortrait(score, score.duration / 2);
  expect(at.pose.gaze).toBe(.9);
  expect(at.pose.turn).toBe(0);
  expect(at.effects.map(e => e.kind)).toEqual(['question']);
});

it('moves a sample toward a short blink peak without adding frames or changing the GIF duration', () => {
  const score = portraitScoreSchema.parse({ ...testScore, duration: 2.6, tracks: [
    { channel: 'blink', keys: [{ at: .105, value: 0 }, { at: .136, value: .98 }, { at: .164, value: 0 }] },
  ] });
  const samples = portraitFrameSchedule(score, 100);
  expect(samples).toHaveLength(26);
  expect(samples.reduce((total, frame) => total + frame.delay, 0)).toBe(2600);
  expect(samples.every(frame => frame.delay >= 30)).toBe(true);
  expect(samples[0].time).toBe(0);
  expect(Math.max(...samples.map(frame => evaluatePortrait(score, frame.time).pose.blink))).toBeGreaterThan(.95);
});
