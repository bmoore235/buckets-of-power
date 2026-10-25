import type { WorkoutSummary } from '../types';

interface SampleRide {
  start: string;
  durationSeconds: number;
  distanceMeters: number;
  averagePower: number;
  t: number[];
  p: number[];
  b: number[];
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
      points: ride.t.map((t, i) => ({ timestamp: startMs + t * 1000, power: ride.p[i], leftRightBalance: ride.b[i] })),
      hasBalance: true,
      selected: true,
    } satisfies WorkoutSummary;
  });
}
