/**
 * Creative Studio (Phase 3d): a stage with sprites for animations, games and stories. This is the
 * part saved in the project (`stage` section). Coordinates are stage units: the stage is 480 × 360
 * with (0, 0) in the centre and y pointing up; direction 90 means facing right.
 */
import { z } from 'zod';
import { TARIRO_COSTUMES } from './tariro.js';

export const STAGE_WIDTH = 480;
export const STAGE_HEIGHT = 360;

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

export const CreativeSpriteSchema = z.object({
  id: Id,
  name: z.string().trim().min(1).max(40),
  /** Costume ids from the art library, in order ("next costume" walks through them). */
  costumes: z.array(z.string().max(40)).min(1).max(80),
  costume: z.number().int().min(0),
  x: z.number(),
  y: z.number(),
  direction: z.number(),
  size: z.number().min(5).max(500),
  visible: z.boolean(),
  /** The sprite's scripts (Blockly serialisation). */
  workspace: z.record(z.string(), z.unknown()).optional(),
});
export type CreativeSprite = z.infer<typeof CreativeSpriteSchema>;

export const StageSchema = z.object({
  backdrops: z.array(z.string().max(40)).min(1).max(20),
  backdrop: z.number().int().min(0),
  sprites: z.array(CreativeSpriteSchema).max(40),
});
export type Stage = z.infer<typeof StageSchema>;

/** Every full-body pose of Tariro, the mascot (the faces are a separate character). */
export const TARIRO_POSES = TARIRO_COSTUMES.filter((c) => c.character === 'Tariro').map((c) => c.id);

/** A new project's stage: Tariro waves and says hello when the green flag is clicked. */
export function defaultStage(): Stage {
  return {
    backdrops: ['sky', 'plain'],
    backdrop: 0,
    sprites: [
      {
        id: 'tariro',
        name: 'Tariro',
        costumes: [...TARIRO_POSES],
        costume: Math.max(0, TARIRO_POSES.indexOf('tariro-idle-1')),
        x: 0,
        y: -60,
        direction: 90,
        size: 100,
        visible: true,
        workspace: {
          blocks: {
            languageVersion: 0,
            blocks: [
              {
                type: 'cs_when_flag',
                id: 'start',
                x: 30,
                y: 30,
                next: {
                  block: {
                    type: 'cs_costume',
                    id: 'wave',
                    fields: { COSTUME: 'tariro-wave-2' },
                    next: {
                      block: {
                        type: 'cs_say_for',
                        id: 'hello',
                        inputs: {
                          TEXT: { shadow: { type: 'text', id: 'hello-t', fields: { TEXT: 'Hello! I am Tariro.' } } },
                          SECS: { shadow: { type: 'math_number', id: 'hello-s', fields: { NUM: 2 } } },
                        },
                        next: { block: { type: 'cs_costume', id: 'rest', fields: { COSTUME: 'tariro-idle-1' } } },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    ],
  };
}
