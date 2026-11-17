/**
 * DC circuit solver for the Simulation Lab: modified nodal analysis with Newton iteration for
 * diodes (LEDs). It finds every node voltage and every element current for one instant.
 *
 * What it models: ideal resistors, ideal voltage sources and diodes with an exponential
 * (Shockley) characteristic. What it does not: capacitors, inductors, transistors, frequency
 * behaviour or component tolerances. PWM outputs are treated as their average voltage. This is
 * a teaching model for simple DC circuits, not a SPICE replacement.
 */

export type Element =
  | { type: 'R'; id: string; a: string; b: string; ohms: number }
  /** Ideal source: v(pos) − v(neg) = volts. */
  | { type: 'V'; id: string; pos: string; neg: string; volts: number }
  /** Diode from anode to cathode: I = is·(exp(V / nVt) − 1). */
  | { type: 'D'; id: string; anode: string; cathode: string; is: number; nVt: number };

export interface Solution {
  /** Node voltages in volts, relative to the ground node. */
  volts: Record<string, number>;
  /** Current through each element in amps: a→b for resistors, anode→cathode for diodes, out of the + terminal for sources. */
  amps: Record<string, number>;
  /** False if the Newton iteration did not settle (the values are then the last estimate). */
  converged: boolean;
}

export const GROUND = 'GND';
/** A tiny conductance from every node to ground, so a floating node reads 0 V instead of breaking the maths. */
const GMIN = 1e-12;

/** Solve A·x = b in place by Gaussian elimination with partial pivoting. Returns undefined if singular. */
function linearSolve(A: number[][], b: number[]): number[] | undefined {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r]![col]!) > Math.abs(A[pivot]![col]!)) pivot = r;
    if (Math.abs(A[pivot]![col]!) < 1e-18) return undefined;
    [A[col], A[pivot]] = [A[pivot]!, A[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    const rowC = A[col]!;
    for (let r = col + 1; r < n; r++) {
      const row = A[r]!;
      const f = row[col]! / rowC[col]!;
      if (f === 0) continue;
      for (let c = col; c < n; c++) row[c]! -= f * rowC[c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r]!;
    const row = A[r]!;
    for (let c = r + 1; c < n; c++) sum -= row[c]! * x[c]!;
    x[r] = sum / row[r]!;
  }
  return x;
}

export function solve(elements: Element[], ground = GROUND): Solution {
  const nodes: string[] = [];
  const index = new Map<string, number>();
  const node = (name: string): number => {
    if (name === ground) return -1;
    let i = index.get(name);
    if (i === undefined) {
      i = nodes.length;
      index.set(name, i);
      nodes.push(name);
    }
    return i;
  };
  for (const e of elements) {
    for (const name of e.type === 'R' ? [e.a, e.b] : e.type === 'V' ? [e.pos, e.neg] : [e.anode, e.cathode]) node(name);
  }
  const sources = elements.filter((e): e is Extract<Element, { type: 'V' }> => e.type === 'V');
  const diodes = elements.filter((e): e is Extract<Element, { type: 'D' }> => e.type === 'D');
  const n = nodes.length;
  const size = n + sources.length;
  /** Diode voltages from the previous iteration (the linearisation point). */
  const vd = new Map<string, number>(diodes.map((d) => [d.id, 0]));
  let x = new Array<number>(size).fill(0);
  let converged = diodes.length === 0;

  for (let iter = 0; iter < 200; iter++) {
    const A = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    const b = new Array<number>(size).fill(0);
    const conductance = (p: number, q: number, g: number) => {
      if (p >= 0) A[p]![p]! += g;
      if (q >= 0) A[q]![q]! += g;
      if (p >= 0 && q >= 0) {
        A[p]![q]! -= g;
        A[q]![p]! -= g;
      }
    };
    for (let i = 0; i < n; i++) A[i]![i]! += GMIN;
    for (const e of elements) {
      if (e.type === 'R') conductance(node(e.a), node(e.b), 1 / Math.max(e.ohms, 1e-6));
      else if (e.type === 'D') {
        // Companion model at the previous voltage: a conductance in parallel with a current source.
        const v = vd.get(e.id)!;
        const ex = Math.exp(v / e.nVt);
        const g = (e.is / e.nVt) * ex + GMIN;
        const i0 = e.is * (ex - 1) - g * v;
        const [p, q] = [node(e.anode), node(e.cathode)];
        conductance(p, q, g);
        if (p >= 0) b[p]! -= i0;
        if (q >= 0) b[q]! += i0;
      }
    }
    sources.forEach((s, k) => {
      const row = n + k;
      const [p, q] = [node(s.pos), node(s.neg)];
      if (p >= 0) {
        A[p]![row]! += 1;
        A[row]![p]! += 1;
      }
      if (q >= 0) {
        A[q]![row]! -= 1;
        A[row]![q]! -= 1;
      }
      b[row] = s.volts;
    });
    const next = linearSolve(A, b);
    if (!next) break;
    x = next;
    if (diodes.length === 0) break;
    // Limit how far each diode voltage may move per step; the exponential diverges otherwise.
    let worst = 0;
    for (const d of diodes) {
      const [p, q] = [node(d.anode), node(d.cathode)];
      const target = (p >= 0 ? x[p]! : 0) - (q >= 0 ? x[q]! : 0);
      const old = vd.get(d.id)!;
      const vcrit = d.nVt * Math.log(d.nVt / (Math.SQRT2 * d.is));
      let v = target;
      if (target > vcrit && Math.abs(target - old) > 2 * d.nVt) {
        v = old > 0 ? old + d.nVt * Math.log(1 + (target - old) / d.nVt) : d.nVt * Math.log(target / d.nVt);
        if (!Number.isFinite(v)) v = vcrit;
      }
      worst = Math.max(worst, Math.abs(v - old), Math.abs(target - v));
      vd.set(d.id, v);
    }
    if (worst < 1e-7) {
      converged = true;
      break;
    }
  }

  const volts: Record<string, number> = { [ground]: 0 };
  nodes.forEach((name, i) => (volts[name] = x[i]!));
  const at = (name: string) => volts[name] ?? 0;
  const amps: Record<string, number> = {};
  for (const e of elements) {
    if (e.type === 'R') amps[e.id] = (at(e.a) - at(e.b)) / Math.max(e.ohms, 1e-6);
    else if (e.type === 'D') amps[e.id] = e.is * (Math.exp((at(e.anode) - at(e.cathode)) / e.nVt) - 1);
  }
  // MNA's source unknown is the current flowing into the + terminal from the circuit; report it leaving.
  sources.forEach((s, k) => (amps[s.id] = -x[n + k]!));
  return { volts, amps, converged };
}

/** Diode parameters for an LED that drops `forwardVolts` at 10 mA. */
export function ledModel(forwardVolts: number): { is: number; nVt: number } {
  const nVt = 0.05;
  return { is: 0.01 / Math.exp(forwardVolts / nVt), nVt };
}
