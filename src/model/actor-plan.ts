import { z } from 'zod';

const xyz = (axis: z.ZodNumber) => z.tuple([axis, axis, axis]);

/** Declarative actor input, convertible with z.toJSONSchema. Coordinates are +Y up, +Z front. */
export const actorPlanSchema = z.strictObject({
  name: z.string().min(1).max(80),
  parts: z.array(z.strictObject({
    shape: z.enum(['sphere', 'box', 'capsule', 'cylinder', 'cone', 'torus']),
    color: z.string().length(7).regex(/^#[0-9A-Fa-f]{6}$/),
    position: xyz(z.number().min(-10).max(10)).describe('XYZ center in actor space (+Y up, +Z front)'),
    size: xyz(z.number().min(0.01).max(10)).describe('Full local XYZ extents before rotation'),
    rotation: xyz(z.number().min(-360).max(360)).describe('XYZ Euler rotation in degrees').optional(),
    joint: z.enum(['body', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'tail']),
  })).min(1).max(24),
});

export type ActorPlan = z.infer<typeof actorPlanSchema>;
