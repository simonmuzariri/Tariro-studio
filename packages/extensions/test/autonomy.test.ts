/** Phase 5b–5c: the drive block in every mode, and the autonomy blocks' generated programs. */
import { describe, expect, it } from 'vitest';
import { checkLive, CreativeRuntime, generateArduino, getBoard, LiveRun, type LiveBoard, type Stage, type WorkspaceJson } from '@tariro-studio/core';
import { createRegistry, EXAMPLES, stageBoardHandlers, type StageBoardIO } from '../src/index.js';
import { block, n, program, workspace } from '../src/build.js';

const registry = createRegistry();
const tariro = getBoard('tariro');
const gen = (ws: WorkspaceJson) => generateArduino(ws, tariro, registry);
const pins = tariro.onboard!.find((p) => p.kind === 'dual-motor-driver')!.pins;

describe('drive block', () => {
  it('turns left by slowing the left wheel, in the uploaded program', () => {
    const r = gen(workspace([program(block('tariro_drive', { fields: { MOVE: 'LEFT' }, inputs: { SPEED: n(50) } }))]));
    expect(r.code).toContain("tariroMotor('A', true, (50) * 0.4);");
    expect(r.code).toContain("tariroMotor('B', true, 50);");
  });

  it('spins in live mode with the wheels in opposite directions', async () => {
    const log: string[] = [];
    const io: LiveBoard = {
      digitalWrite: async (p, on) => void log.push(`${p}=${on ? 1 : 0}`),
      analogWrite: async (p, v) => void log.push(`${p}~${v}`),
      servoWrite: async () => {},
      digitalRead: async () => false,
      analogRead: async () => 0,
      analogPin: async () => undefined,
    };
    const ws = workspace([program(block('tariro_drive', { fields: { MOVE: 'SPIN_RIGHT' }, inputs: { SPEED: n(100) } }))]);
    expect(checkLive(ws, tariro, registry)).toEqual([]);
    await new LiveRun(ws, tariro, registry, { io, sleep: async () => {}, now: () => 0, print: () => {}, onBlock: () => {} }).run();
    expect(log).toEqual([`${pins['INA']}=1`, `${pins['ENA']}~255`, `${pins['INB']}=0`, `${pins['ENB']}~255`]);
  });

  it('drives from a sprite program in Stage mode', () => {
    const log: string[] = [];
    const io: StageBoardIO = { digitalWrite: (p, on) => void log.push(`${p}=${on ? 1 : 0}`), analogWrite: (p, v) => void log.push(`${p}~${v}`), servoWrite: () => {}, digitalRead: () => false, analogRead: () => 0 };
    const stage: Stage = {
      backdrops: ['plain'],
      backdrop: 0,
      sprites: [
        {
          id: 's',
          name: 's',
          costumes: ['ball'],
          costume: 0,
          x: 0,
          y: 0,
          direction: 90,
          size: 100,
          visible: true,
          workspace: { blocks: { blocks: [{ type: 'cs_when_flag', id: 'f', next: { block: { type: 'tariro_drive', id: 'd', fields: { MOVE: 'BACKWARD' }, inputs: { SPEED: { block: { type: 'math_number', id: 'x', fields: { NUM: 40 } } } } } } }] } },
        },
      ],
    };
    const rt = new CreativeRuntime(stage, { board: stageBoardHandlers(io, tariro) });
    rt.greenFlag();
    rt.step(16);
    expect(rt.problems).toEqual([]);
    expect(log).toEqual([`${pins['INA']}=0`, `${pins['ENA']}~102`, `${pins['INB']}=0`, `${pins['ENB']}~102`]);
  });
});

describe('autonomy blocks (Upload mode)', () => {
  it('drive until an obstacle: measures with the ultrasonic sensor, treats "no echo" as far, then stops', () => {
    const r = gen(workspace([program(block('auto_until_obstacle', { fields: { TRIG: '12', ECHO: '13' }, inputs: { SPEED: n(45), CM: n(15) } }))]));
    expect(r.warnings.filter((w) => !/placeholder/.test(w.message))).toEqual([]);
    expect(r.code).toContain('double d = tariroDistanceCm(12, 13);');
    expect(r.code).toContain('if (d > 0 && d < 15) break;');
    expect(r.code).toMatch(/break;[\s\S]*\}\n\s*tariroMotorStop\('A'\);\n\s*tariroMotorStop\('B'\);/);
  });

  it('line following steers towards the sensor that sees the line and remembers which side it was', () => {
    const r = gen(workspace([program(block('auto_follow_line', { fields: { LEFT: '8', RIGHT: '9' }, inputs: { SPEED: n(40) } }))]));
    expect(r.code).toContain('int tariroLineLast = 0;');
    expect(r.code).toContain('} else if (onLeft) {\n    tariroLineLast = -1;');
    expect(r.code).toContain('pinMode(8, INPUT);');
  });

  it('distance and turns use both wheel encoders, correct drift, and give up after a time limit', () => {
    const square = EXAMPLES.find((e) => e.name === 'autonomy-square')!;
    const r = gen(square.workspace);
    expect(r.code).toContain('tariroDriveCm(40, 50);');
    expect(r.code).toContain('tariroTurnDeg(false, 90, 40, 13);');
    expect(r.code).toContain('millis() - start < 15000UL');
    expect(r.code).toContain('double arc = 3.14159265 * trackCm * fabs(degrees) / 360.0;');
  });

  it('the autonomy blocks are Upload-only: live mode names them', () => {
    const ws = workspace([program(block('auto_drive_cm', { inputs: { CM: n(10), SPEED: n(50) } }))]);
    expect(checkLive(ws, tariro, registry)[0]?.message).toMatch(/Use Upload/);
  });
});

describe('AI traffic-light car example', () => {
  it('opens in Stage mode with Green, Red and Nothing classes and drives through the board blocks', () => {
    const ex = EXAMPLES.find((e) => e.name === 'ai-traffic-light-car')!;
    expect(ex.opensIn).toBe('stage');
    expect(ex.ai?.classes.map((c) => c.name)).toEqual(['Green', 'Red', 'Nothing']);
    const scripts = JSON.stringify(ex.stage!.sprites[0]!.workspace);
    for (const t of ['ai_video', 'ai_is', 'tariro_drive', 'tariro_motor_stop', 'cs_next_in_group']) expect(scripts).toContain(`"type":"${t}"`);
    // Without a trained model, "AI sees Green?" is false: the car waits.
    const log: string[] = [];
    const io: StageBoardIO = { digitalWrite: (p, on) => void log.push(`${p}=${on ? 1 : 0}`), analogWrite: (p, v) => void log.push(`${p}~${v}`), servoWrite: () => {}, digitalRead: () => false, analogRead: () => 0 };
    const rt = new CreativeRuntime(ex.stage!, { board: { ...stageBoardHandlers(io, tariro), ai_video: { kind: 'statement', run: () => {} }, ai_is: { kind: 'value', run: () => false } } });
    rt.greenFlag();
    for (let i = 0; i < 3; i++) rt.step(50);
    expect(rt.problems).toEqual([]);
    expect(log.every((l) => l.endsWith('~0') || l.endsWith('=0'))).toBe(true);
    expect(rt.view().sprites[0]!.say?.text).toBe('I am not sure, so I wait.');
  });
});
