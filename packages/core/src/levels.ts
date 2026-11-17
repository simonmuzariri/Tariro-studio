/**
 * Experience levels (EXPANSION_PLAN A7). A toolbox entry marked with a level is shown from that
 * level up; unmarked entries are shown at every level. Blocks already in a program always work,
 * whatever the level: the level only decides what the toolbox offers.
 */
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
export const EXPERIENCE_LEVELS: readonly ExperienceLevel[] = ['beginner', 'intermediate', 'advanced'];

export const LEVEL_INFO: Record<ExperienceLevel, { name: string; description: string }> = {
  beginner: { name: 'Beginner', description: 'The first blocks: start, loops, waits, decisions, lights, buttons, motors.' },
  intermediate: { name: 'Intermediate', description: 'Adds timing, maths, text, serial, functions, encoders, drivers and the arm.' },
  advanced: { name: 'Advanced', description: 'Every block, including PID, encoder tuning and stepper positioning.' },
};
