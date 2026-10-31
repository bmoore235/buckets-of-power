import type { WorkoutSummary } from '../types';

interface SampleRide {
  start: string;
  durationSeconds: number;
  distanceMeters: number;
  averagePower: number;
  t: (number | null)[];
  p: (number | null)[];
  b: (number | null)[];
  c?: (number | null)[];
  lp?: (number[] | null)[];
  lpp?: (number[] | null)[];
  rp?: (number[] | null)[];
  rpp?: (number[] | null)[];
}

export async function loadSampleWorkouts(): Promise<WorkoutSummary[]> {
  const modules = import.meta.glob<SampleRide>('../../samples/ride-*.json', { import: 'default' });
  const entries = await Promise.all(Object.entries(modules).sort(([a], [b]) => a.localeCompare(b)).map(async ([path, load]) => [path, await load()] as const));
  return entries.map(([path, ride], index) => {
    const startMs = new Date(ride.start).getTime();
    return {
      id: `sample-${index + 1}`,
      name: `Sample ride ${path.match(/ride-(.+)\.json$/)![1]}`,
      date: new Date(startMs).toISOString(),
      durationSeconds: ride.durationSeconds,
      distanceMeters: ride.distanceMeters,
      averagePower: ride.averagePower,
      points: ride.t.map((t, i) => ({
        timestamp: t == null ? null : startMs + t * 1000,
        power: ride.p[i],
        leftRightBalance: ride.b[i],
        cadence: ride.c?.[i] ?? null,
        leftPowerPhase: ride.lp?.[i] ?? null,
        leftPowerPhasePeak: ride.lpp?.[i] ?? null,
        rightPowerPhase: ride.rp?.[i] ?? null,
        rightPowerPhasePeak: ride.rpp?.[i] ?? null,
      })),
      hasBalance: ride.b.some((balance) => balance != null),
      selected: true,
    } satisfies WorkoutSummary;
  });
}
