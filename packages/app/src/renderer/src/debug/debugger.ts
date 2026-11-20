import { useSyncExternalStore } from 'react';
import type { LiveRun, PauseReason, PinWatch, VariableWatch } from '@tariro-studio/core';

export type DebugTarget = 'simulation' | 'live';

export interface DebugSnapshot {
  /** Block ids with a breakpoint. */
  breakpoints: ReadonlySet<string>;
  /** What is running: the simulator, a real board, or nothing. */
  target: DebugTarget | null;
  paused: { blockId: string; reason: PauseReason } | undefined;
  variables: VariableWatch[];
  pins: PinWatch[];
}

/**
 * The block debugger (Phase 8c): breakpoints set on blocks, and the program that is running (on the
 * simulator or a real board in live mode), which it can pause, continue and step. While a program
 * runs, its variables and pins are read about four times a second.
 */
class Debugger {
  private readonly breakpoints = new Set<string>();
  private run: LiveRun | null = null;
  private target: DebugTarget | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly listeners = new Set<() => void>();
  private snapshot: DebugSnapshot = { breakpoints: new Set(), target: null, paused: undefined, variables: [], pins: [] };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): DebugSnapshot => this.snapshot;

  /** A program starts: it stops at the breakpoints set now and later. */
  attach(run: LiveRun, target: DebugTarget): void {
    this.run = run;
    this.target = target;
    run.setBreakpoints(this.breakpoints);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refresh(), 250);
    this.refresh();
  }

  /** The program ended. */
  detach(run: LiveRun): void {
    if (this.run !== run) return;
    this.run = null;
    this.target = null;
    clearInterval(this.timer);
    this.refresh();
  }

  has(blockId: string): boolean {
    return this.breakpoints.has(blockId);
  }

  toggle(blockId: string): void {
    if (this.breakpoints.has(blockId)) this.breakpoints.delete(blockId);
    else this.breakpoints.add(blockId);
    this.run?.setBreakpoints(this.breakpoints);
    this.refresh();
  }

  clear(): void {
    this.breakpoints.clear();
    this.run?.setBreakpoints(this.breakpoints);
    this.refresh();
  }

  pause(): void {
    this.run?.pause();
  }

  resume(): void {
    this.run?.resume();
    this.refresh();
  }

  step(): void {
    this.run?.step();
    this.refresh();
  }

  /** Called by the run when it pauses, so the panel shows it at once. */
  refresh = (): void => {
    const run = this.run;
    this.snapshot = {
      breakpoints: new Set(this.breakpoints),
      target: this.target,
      paused: run?.pausedAt,
      variables: run ? run.variables() : this.snapshot.variables,
      pins: run ? [...run.pinWatch.values()].sort((a, b) => a.pin - b.pin) : this.snapshot.pins,
    };
    for (const l of this.listeners) l();
  };
}

export const debug = new Debugger();

export function useDebugger(): DebugSnapshot {
  return useSyncExternalStore(debug.subscribe, debug.getSnapshot);
}
