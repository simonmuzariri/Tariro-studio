/** Parse Serial Monitor text into plot series (same conventions as the Arduino serial plotter). */

export interface PlotData {
  /** Series names in first-seen order. */
  series: string[];
  /** One row per parsed line; a value is undefined when that line lacked the series. */
  rows: Array<Array<number | undefined>>;
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/**
 * Each complete line is one sample. Values are separated by commas, semicolons, tabs or spaces
 * and may be labelled ("temp:25" or "temp=25"); unlabelled values are named by position.
 * Lines without any number (ordinary messages) are skipped. Only the last `maxRows` are kept.
 */
export function parsePlot(text: string, maxRows = 300): PlotData {
  const lines = text.split(/\r?\n/);
  lines.pop(); // the last piece is an incomplete line (or empty after a final newline)
  const series: string[] = [];
  const index = new Map<string, number>();
  const rows: PlotData['rows'] = [];
  for (const line of lines.slice(-maxRows * 2)) {
    const row: Array<number | undefined> = [];
    let position = 0;
    let found = false;
    for (const token of line.replace(/\s*([:=])\s*/g, '$1').split(/[,;\t ]+/).filter(Boolean)) {
      const m = /^([^:=]+)[:=](.+)$/.exec(token);
      const raw = m ? m[2]! : token;
      if (!NUMBER.test(raw)) continue;
      const name = m ? m[1]! : `value ${++position}`;
      let i = index.get(name);
      if (i === undefined) {
        i = series.length;
        index.set(name, i);
        series.push(name);
      }
      row[i] = Number(raw);
      found = true;
    }
    if (found) rows.push(row);
  }
  return { series, rows: rows.slice(-maxRows) };
}

export function plotRange(data: PlotData): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const row of data.rows)
    for (const v of row)
      if (v !== undefined) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
  if (!Number.isFinite(min)) return { min: 0, max: 1 };
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}
