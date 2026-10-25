import type { DataPoint, WorkoutSummary } from './types';

const DB_NAME = 'bucketsofpower';
const META = 'workouts';
const POINTS = 'points';

type Meta = Omit<WorkoutSummary, 'points'>;
type Phases = [number, number[] | null, number[] | null, number[] | null, number[] | null];
// Columnar layout keeps repeated keys and absent fields out of the stored data.
interface StoredPoints { t: Array<number | null>; p: Array<number | null>; b: Array<number | null>; c: Array<number | null>; ph: Phases[] }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(META, { keyPath: 'id' });
      request.result.createObjectStore(POINTS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function pack(points: DataPoint[]): StoredPoints {
  const out: StoredPoints = { t: [], p: [], b: [], c: [], ph: [] };
  points.forEach((point, i) => {
    out.t.push(point.timestamp);
    out.p.push(point.power);
    out.b.push(point.leftRightBalance);
    out.c.push(point.cadence ?? null);
    const { leftPowerPhase: a = null, leftPowerPhasePeak: b = null, rightPowerPhase: c = null, rightPowerPhasePeak: d = null } = point;
    if (a || b || c || d) out.ph.push([i, a, b, c, d]);
  });
  return out;
}

function unpack(stored: StoredPoints): DataPoint[] {
  const points: DataPoint[] = stored.t.map((timestamp, i) => ({ timestamp, power: stored.p[i], leftRightBalance: stored.b[i], cadence: stored.c[i] }));
  for (const [i, a, b, c, d] of stored.ph) Object.assign(points[i], { leftPowerPhase: a, leftPowerPhasePeak: b, rightPowerPhase: c, rightPowerPhasePeak: d });
  return points;
}

export async function loadStoredWorkouts(): Promise<WorkoutSummary[]> {
  const db = await open();
  try {
    const tx = db.transaction([META, POINTS], 'readonly');
    const metas = await request<Meta[]>(tx.objectStore(META).getAll());
    return await Promise.all(metas.map(async (meta) => {
      const stored = await request<StoredPoints | undefined>(tx.objectStore(POINTS).get(meta.id));
      return { ...meta, points: stored ? unpack(stored) : [] };
    }));
  } finally {
    db.close();
  }
}

// Point data is written once per workout; later syncs only rewrite metadata (e.g. selection).
export async function syncStoredWorkouts(workouts: WorkoutSummary[], previousIds: Set<string>): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction([META, POINTS], 'readwrite');
    const finished = done(tx);
    const ids = new Set(workouts.map((workout) => workout.id));
    for (const workout of workouts) {
      const { points, ...meta } = workout;
      tx.objectStore(META).put(meta);
      if (!previousIds.has(workout.id)) tx.objectStore(POINTS).put(pack(points), workout.id);
    }
    for (const id of previousIds) {
      if (!ids.has(id)) { tx.objectStore(META).delete(id); tx.objectStore(POINTS).delete(id); }
    }
    await finished;
  } finally {
    db.close();
  }
}
