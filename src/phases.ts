import type { AnalysisOptions, WorkoutSummary } from './types';

export interface Arc { start: number; end: number }
export interface SidePhase { phase: Arc; peak: Arc; samples: number }
export interface PhaseResult { left: SidePhase | null; right: SidePhase | null }

const rad = (deg: number) => deg * Math.PI / 180;
const mod = (deg: number) => ((deg % 360) + 360) % 360;
const span = (arc: number[]) => mod(arc[1] - arc[0]);
// Full-circle placeholders (~357°) carry no information.
const valid = (arc: number[] | null | undefined): arc is number[] => !!arc && arc.length >= 2 && span(arc) > 0 && span(arc) < 300;

function newAcc() { return { ps: [0, 0], pe: [0, 0], ks: [0, 0], ke: [0, 0], n: 0 }; }

function mean(sum: number[], n: number) { return mod(Math.atan2(sum[1] / n, sum[0] / n) * 180 / Math.PI); }

// Circular mean of arc endpoints (angles are degrees clockwise from top dead centre).
export function computePhases(workouts: WorkoutSummary[], options: AnalysisOptions): PhaseResult {
  const sides = { left: newAcc(), right: newAcc() };
  const addAngle = (sum: number[], deg: number) => { sum[0] += Math.cos(rad(deg)); sum[1] += Math.sin(rad(deg)); };
  for (const workout of workouts) {
    if (!workout.selected || workout.error) continue;
    const start = workout.points.find((point) => point.timestamp != null)?.timestamp ?? null;
    for (const point of workout.points) {
      if (point.power == null) continue;
      if ((options.min_watts != null && point.power < options.min_watts) || (options.max_watts != null && point.power >= options.max_watts)) continue;
      if (start != null && point.timestamp != null) {
        const minute = (point.timestamp - start) / 60000;
        if ((options.min_minute != null && minute < options.min_minute) || (options.max_minute != null && minute >= options.max_minute)) continue;
      }
      for (const [side, phase, peak] of [['left', point.leftPowerPhase, point.leftPowerPhasePeak], ['right', point.rightPowerPhase, point.rightPowerPhasePeak]] as const) {
        if (!valid(phase) || !valid(peak)) continue;
        const acc = sides[side];
        addAngle(acc.ps, phase[0]); addAngle(acc.pe, phase[1]); addAngle(acc.ks, peak[0]); addAngle(acc.ke, peak[1]);
        acc.n++;
      }
    }
  }
  const finish = (acc: ReturnType<typeof newAcc>): SidePhase | null => acc.n === 0 ? null : {
    phase: { start: mean(acc.ps, acc.n), end: mean(acc.pe, acc.n) },
    peak: { start: mean(acc.ks, acc.n), end: mean(acc.ke, acc.n) },
    samples: acc.n,
  };
  return { left: finish(sides.left), right: finish(sides.right) };
}
