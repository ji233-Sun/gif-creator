import { z } from 'zod';

const xyz = (axis: z.ZodNumber) => z.tuple([axis, axis, axis]);
const shapes = ['sphere', 'box', 'capsule', 'cylinder', 'cone', 'torus', 'dome', 'flare', 'lock'] as const;
const finishes = ['matte', 'gloss', 'metal'] as const;
const joints = ['body', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'tail'] as const;
const maxParts = 40;
const color = /^#[0-9A-Fa-f]{6}$/;
const fields = {
  position: { min: -10, max: 10, description: 'XYZ bounding box center in actor space (+Y up, +Z front)' },
  size: { min: 0.01, max: 10, description: 'Full local XYZ extents before rotation' },
  rotation: { min: -360, max: 360, description: 'XYZ Euler rotation in degrees; optional' },
};
const vector = ({ min, max, description }: typeof fields.size) => xyz(z.number().min(min).max(max)).describe(description);
const mirrorDescription = 'Reflect this off-center part across X=0. Left/right arm and leg joints swap. Ignored when |X| < 0.01.';
const finishDescription = 'Optional surface: matte (default), gloss (eyes/polished details), metal (metallic accessories).';

/** Declarative actor input. Coordinates are +Y up, +Z front. A mirrored entry creates two parts. */
export const actorPlanSchema = z.strictObject({
  name: z.string().min(1).max(80),
  parts: z.array(z.strictObject({
    shape: z.enum(shapes),
    color: z.string().length(7).regex(color),
    position: vector(fields.position),
    size: vector(fields.size),
    rotation: vector(fields.rotation).optional(),
    joint: z.enum(joints),
    mirror: z.boolean().describe(mirrorDescription).optional(),
    finish: z.enum(finishes).describe(finishDescription).optional(),
  })).min(1).max(maxParts),
});

// The upstream protocols share homogeneous arrays more reliably than JSON Schema tuple syntax.
const toolVector = ({ min, max, description }: typeof fields.size) => ({
  type: 'array', minItems: 3, maxItems: 3, description,
  items: { type: 'number', minimum: min, maximum: max },
});
export const actorPlanToolSchema = {
  type: 'object', additionalProperties: false, required: ['name', 'parts'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    parts: { type: 'array', minItems: 1, maxItems: maxParts, items: {
      type: 'object', additionalProperties: false, required: ['shape', 'color', 'position', 'size', 'joint'],
      properties: {
        shape: { type: 'string', enum: [...shapes] },
        color: { type: 'string', description: '#RRGGBB 色值', pattern: color.source },
        position: toolVector(fields.position), size: toolVector(fields.size), rotation: toolVector(fields.rotation),
        joint: { type: 'string', enum: [...joints] },
        mirror: { type: 'boolean', description: mirrorDescription },
        finish: { type: 'string', enum: [...finishes], description: finishDescription },
      },
    } },
  },
};

export const actorPlanTokenBudget = 6144;

export type ActorPlan = z.infer<typeof actorPlanSchema>;
