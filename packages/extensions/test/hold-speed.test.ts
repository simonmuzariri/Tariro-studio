/**
 * Phase 5c: "hold both wheels at N RPM". The C++ controller the block uploads, compiled with the
 * computer's C++ compiler and run against two simulated motors of different strength (with a
 * dead band and a lag, read through a coarse encoder that counts whole pulses every 50 ms).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getBoard, generateArduino } from '@tariro-studio/core';
import { createRegistry } from '../src/index.js';
import { block, n, program, workspace } from '../src/build.js';
import { HOLD_SPEED_CPP } from '../src/tariro-board.js';

const gpp = spawnSync('g++', ['--version']).status === 0;

/** Counts per wheel turn: a 20-slot disc read on both edges, a coarse but common hobby encoder. */
const COUNTS_PER_TURN = 40;

const HARNESS = (controller: string) => `
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#define constrain(a, lo, hi) ((a) < (lo) ? (lo) : ((a) > (hi) ? (hi) : (a)))
static unsigned long simMs = 0;
unsigned long millis() { return simMs; }
// Two motors: RPM at full power, dead band (% power that does not turn the wheel), lag.
static double fullRpm[2] = {220, 160};
static const double deadband = 15, tau = 0.15;
static double rpm[2] = {0, 0}, measured[2] = {0, 0}, turns[2] = {0, 0};
static long lastCount[2] = {0, 0};
static const double countsPerTurn = ${COUNTS_PER_TURN};
static bool stuck[2] = {false, false};
double tariroEncoderTurnsPerSecond(uint8_t i) { return measured[i] / 60.0; }
${controller}
int main(int argc, char **argv) {
  double target = atof(argv[1]), maxPower = atof(argv[2]);
  const char *scenario = argv[3];
  double power[2] = {0, 0};
  for (simMs = 1; simMs <= 8000; simMs++) {
    if (scenario[0] == 's' && simMs == 4000) fullRpm[0] *= 0.7;   // slope: the left wheel gets harder to turn
    if (scenario[0] == 'j') stuck[1] = simMs < 3000;               // jammed: the right wheel is held for 3 s
    if (simMs % 20 == 0)                                            // the program's loop, every 20 ms
      for (int i = 0; i < 2; i++) power[i] = tariroHoldPower(i, target, maxPower);
    for (int i = 0; i < 2; i++) {
      double goal = stuck[i] ? 0 : (power[i] > deadband ? (power[i] - deadband) / (100 - deadband) * fullRpm[i] : 0);
      rpm[i] += (goal - rpm[i]) * 0.001 / tau;
      turns[i] += rpm[i] / 60.0 * 0.001;
      if (simMs % 50 == 0) {                                        // the encoder measures every 50 ms, in whole counts
        long c = (long)floor(turns[i] * countsPerTurn);
        measured[i] = (c - lastCount[i]) / countsPerTurn * 60.0 / 0.05;
        lastCount[i] = c;
      }
    }
    if (simMs % 500 == 0) printf("%lu %.1f %.1f %.1f %.1f\\n", simMs, rpm[0], rpm[1], power[0], power[1]);
  }
}
`;

type Row = { ms: number; rpm: [number, number]; power: [number, number] };
/** The simulator, compiled once and shared by the tests (compiling is the slow part). */
let binary: string | undefined;
function simulator(): string {
  if (!binary) {
    const dir = mkdtempSync(join(tmpdir(), 'tariro-hold-'));
    writeFileSync(join(dir, 'sim.cpp'), HARNESS(HOLD_SPEED_CPP));
    execFileSync('g++', ['-O1', '-o', join(dir, 'sim'), join(dir, 'sim.cpp')]);
    binary = join(dir, 'sim');
  }
  return binary;
}

function simulate(target: number, max: number, scenario: 'flat' | 'slope' | 'jammed'): Row[] {
  const out = execFileSync(simulator(), [String(target), String(max), scenario], { encoding: 'utf8' });
  return out
    .trim()
    .split('\n')
    .map((l) => l.split(' ').map(Number))
    .map(([ms, a, b, pa, pb]) => ({ ms: ms!, rpm: [a!, b!], power: [pa!, pb!] }));
}
const at = (rows: Row[], ms: number) => rows.find((r) => r.ms === ms)!;

// Compiling C++ can take a while on a busy computer.
describe('hold both wheels at a speed (Upload mode)', { timeout: 60_000 }, () => {
  it('generates a PI loop per wheel, limited to the power given', () => {
    const r = generateArduino(workspace([program(block('auto_hold_speed', { fields: { DIR: 'FORWARD' }, inputs: { RPM: n(90), MAX: n(70) } }))]), getBoard('tariro'), createRegistry());
    expect(r.code).toContain("tariroMotor('A', true, tariroHoldPower(0, 90, constrain(70, 0, 100)));");
    expect(r.code).toContain("tariroMotor('B', true, tariroHoldPower(1, 90, constrain(70, 0, 100)));");
    expect(r.code).toContain('double tariroHoldPower(uint8_t i, double targetRpm, double maxPower)');
    expect(r.code).toContain('double tariroEncoderTurnsPerSecond(uint8_t i)');
  });

  it.skipIf(!gpp)('brings a strong and a weak motor to the same speed within 1.5 s, and keeps it there', () => {
    const rows = simulate(90, 90, 'flat');
    for (const ms of [1500, 3000, 8000]) for (const w of [0, 1]) expect(Math.abs(at(rows, ms).rpm[w] - 90), `wheel ${w} at ${ms} ms`).toBeLessThan(4.5);
    // The weaker motor needs more power for the same speed.
    expect(at(rows, 8000).power[1]).toBeGreaterThan(at(rows, 8000).power[0] + 5);
    // No wild overshoot on the way.
    expect(Math.max(...rows.flatMap((r) => r.rpm))).toBeLessThan(90 * 1.15);
  });

  it.skipIf(!gpp)('makes up for a slope that slows one wheel', () => {
    const rows = simulate(90, 100, 'slope');
    expect(at(rows, 4500).rpm[0]).toBeLessThan(88); // just after the slope starts
    expect(Math.abs(at(rows, 6000).rpm[0] - 90)).toBeLessThan(4.5);
    expect(at(rows, 6000).power[0]).toBeGreaterThan(at(rows, 3500).power[0]);
  });

  it.skipIf(!gpp)('never goes over the power limit, and a jammed wheel does not wind it up', () => {
    const rows = simulate(90, 60, 'jammed');
    expect(Math.max(...rows.flatMap((r) => r.power))).toBeLessThanOrEqual(60);
    // Released at 3 s: back to speed (the strong wheel can reach 90 RPM at 60 %; the weak one cannot,
    // so it stays at the limit) without a burst above the target.
    expect(Math.abs(at(rows, 5000).rpm[0] - 90)).toBeLessThan(4.5);
    expect(Math.max(...rows.filter((r) => r.ms > 3000).map((r) => r.rpm[1]))).toBeLessThan(90 * 1.05);
  });
});
