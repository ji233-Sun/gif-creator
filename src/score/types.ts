/**
 * 动作谱（Score）类型定义
 */

export interface ScoreClip {
  verb: string;
  from: number;
  to: number;
  params: Record<string, number | string | boolean>;
}

export interface Score {
  duration: number;
  fps: number;
  actor: ScoreClip[];
  camera: ScoreClip[];
  fx: Array<{
    type: string;
    anchor: string;
    from: number;
    to: number;
  }>;
  caption?: {
    text: string;
    style: string;
  };
}

export interface Knobs {
  exaggeration: number;
  speed: number;
}
