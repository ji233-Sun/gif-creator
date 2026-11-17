import { describe, it, expect } from "vitest";
import { evaluate } from "./index";
import { Score } from "./types";

describe("score evaluator", () => {
  it("returns a pose for t=0", () => {
    const score: Score = {
      duration: 1,
      fps: 20,
      actor: [],
      camera: [],
      fx: [],
    };
    const pose = evaluate(score, 0, { exaggeration: 1, speed: 1 });
    expect(pose).toBeDefined();
  });
});
