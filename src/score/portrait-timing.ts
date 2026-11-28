import type { PortraitScore } from './portrait';

/** GIF uses centiseconds. Shift a nearby sample to strong blink peaks without adding frames. */
export function portraitFrameSchedule(score: PortraitScore, targetDelay: number) {
  const total = Math.round(score.duration * 100);
  const count = Math.round(total * 10 / targetDelay);
  const base = Array.from({ length: count + 1 }, (_, index) => Math.round(index * total / count));
  const times = [...base];
  const blink = score.tracks.find(track => track.channel === 'blink');
  const peaks = (blink?.keys ?? []).filter((key, i, keys) => key.value >= 0.7 &&
    key.value >= (keys[i - 1]?.value ?? 0) && key.value >= (keys[i + 1]?.value ?? 0))
    .sort((a, b) => b.value - a.value);
  const moved = new Set<number>();
  for (const peak of peaks) {
    const tick = Math.round(peak.at * total);
    let nearest = 1;
    for (let i = 2; i < count; i++) if (Math.abs(base[i] - tick) < Math.abs(base[nearest] - tick)) nearest = i;
    const previousGap = tick - times[nearest - 1], nextGap = times[nearest + 1] - tick;
    if (!moved.has(nearest) && Math.abs(base[nearest] - tick) <= Math.ceil(targetDelay / 20) &&
      previousGap >= 3 && nextGap >= 3 && previousGap <= 20 && nextGap <= 20) {
      times[nearest] = tick; moved.add(nearest);
    }
  }
  return times.slice(0, -1).map((tick, index) => ({ time: tick * score.duration / total, delay: (times[index + 1] - tick) * 10 }));
}
