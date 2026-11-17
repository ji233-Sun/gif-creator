import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type Actor = "bunny" | "cat" | "slime";
export type Mood = "happy" | "speechless" | "crazy";

export function Mascot({
  actor = "bunny",
  mood = "happy",
  playing = true,
  intensity = 6,
  miniature = false,
}: {
  actor?: Actor;
  mood?: Mood;
  playing?: boolean;
  intensity?: number;
  miniature?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "mascot-scene",
        miniature && "miniature",
        !playing && "paused",
      )}
      style={
        {
          "--bounce": `${8 + intensity * 2}px`,
          "--tempo": `${1.8 - intensity * 0.08}s`,
        } as CSSProperties
      }
      data-mood={mood}
    >
      <div className="mascot-shadow" />
      <div className={cn("mascot", `mascot-${actor}`)}>
        <div className="ear ear-left">
          <span />
        </div>
        <div className="ear ear-right">
          <span />
        </div>
        <div className="mascot-body">
          <div className="mascot-shine" />
          <div className="mascot-face">
            <span className="eye eye-left" />
            <span className="eye eye-right" />
            <span className="cheek cheek-left" />
            <span className="cheek cheek-right" />
            <span className="mouth" />
          </div>
          <span className="paw paw-left" />
          <span className="paw paw-right" />
        </div>
        <span className="foot foot-left" />
        <span className="foot foot-right" />
      </div>
    </div>
  );
}
