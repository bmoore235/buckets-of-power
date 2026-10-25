import type { AnalysisOptions, AnalysisResult, DataPoint, GroupBy, WorkoutSummary } from './types';

const NO_BUCKETS = 'No buckets matched. Records need power plus left/right balance (dual-sided power meter), and the watt range / min_datapoints filters may be too strict.';
type Totals = { left: number; right: number; count: number; range: [number, number] };

function roundHalfEven(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  if (Math.abs(fraction - 0.5) < 1e-9) return (floor % 2 === 0 ? floor : floor + 1) / factor;
  return Math.round(scaled) / factor;
}

function roundPercent(value: number) {
  const scaled = value * 100;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  if (Math.abs(fraction - 0.5) < 1e-9) return (floor % 2 === 0 ? floor : floor + 1) / 100;
  return Math.round(scaled) / 100;
}

export function decodeBalance(raw: number, power?: number | null) {
  const pct = raw & 0x7f;
  const right_pct = (raw & 0x80) !== 0 ? pct : 100 - pct;
  const left_pct = 100 - right_pct;
  return {
    left_pct,
    right_pct,
    ...(power == null ? {} : { left_watts: roundHalfEven(power * left_pct / 100), right_watts: roundHalfEven(power * right_pct / 100) }),
  };
}

function split(point: DataPoint) {
  if (point.power == null || point.power < 0 || point.leftRightBalance == null) return null;
  const values = decodeBalance(point.leftRightBalance, point.power);
  return { left: values.left_watts!, right: values.right_watts! };
}

function add(map: Map<string, Totals>, lower: number, upper: number, values: { left: number; right: number }) {
  const key = `${lower}:${upper}`;
  const bucket = map.get(key) ?? { left: 0, right: 0, count: 0, range: [lower, upper] };
  bucket.left += values.left;
  bucket.right += values.right;
  bucket.count++;
  map.set(key, bucket);
}

type Bucket = Totals;

export function bucketByPower(workouts: WorkoutSummary[], options: AnalysisOptions): Bucket[] {
  if (!Number.isInteger(options.bucket_size) || options.bucket_size <= 0) throw new RangeError('bucket_size must be a positive integer');
  const map = new Map<string, Totals>();
  let highest = -1;
  for (const workout of workouts) {
    const start = workout.points.find((point) => point.timestamp != null)?.timestamp;
    for (const point of workout.points) {
      const values = split(point);
      if (!values) continue;
      if (options.min_minute != null || options.max_minute != null) {
        if (point.timestamp == null || start == null) continue;
        const minute = (point.timestamp - start) / 60000;
        if ((options.min_minute != null && minute < options.min_minute) || (options.max_minute != null && minute >= options.max_minute)) continue;
      }
      const index = Math.floor(point.power! / options.bucket_size);
      highest = Math.max(highest, index);
      add(map, index * options.bucket_size, (index + 1) * options.bucket_size, values);
    }
  }
  for (let i = 0; i <= highest; i++) {
    const key = `${i * options.bucket_size}:${(i + 1) * options.bucket_size}`;
    if (!map.has(key)) map.set(key, { left: 0, right: 0, count: 0, range: [i * options.bucket_size, (i + 1) * options.bucket_size] });
  }
  return [...map.values()].sort((a, b) => a.range[0] - b.range[0]);
}

export function bucketByTime(workouts: WorkoutSummary[], options: AnalysisOptions): Bucket[] {
  if (!Number.isInteger(options.time_bucket_minutes) || options.time_bucket_minutes <= 0) throw new RangeError('time_bucket_minutes must be a positive integer');
  const map = new Map<string, Totals>();
  for (const workout of workouts) {
    const start = workout.points.find((point) => point.timestamp != null)?.timestamp;
    if (start == null) continue;
    for (const point of workout.points) {
      const values = split(point);
      if (!values || point.timestamp == null) continue;
      const power = point.power!;
      if ((options.min_watts != null && power < options.min_watts) || (options.max_watts != null && power >= options.max_watts)) continue;
      const index = Math.floor((point.timestamp - start) / (options.time_bucket_minutes * 60000));
      if (index < 0) continue;
      add(map, index * options.time_bucket_minutes, (index + 1) * options.time_bucket_minutes, values);
    }
  }
  return [...map.values()].sort((a, b) => a.range[0] - b.range[0]);
}

function formatDuration(seconds: number) {
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 3600)).padStart(2, '0')}:${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

function summarize(buckets: Bucket[], groupBy: GroupBy, sampleSeconds: number) {
  const rows = buckets.map((bucket) => {
    const total = bucket.left + bucket.right;
    return {
      [groupBy === 'power' ? 'watts' : 'minutes']: bucket.range,
      left_pct: total ? roundPercent(bucket.left / total * 100) : null,
      right_pct: total ? roundPercent(bucket.right / total * 100) : null,
      datapoints: bucket.count,
      duration: formatDuration(bucket.count * sampleSeconds),
    };
  });
  const left = buckets.reduce((sum, bucket) => sum + bucket.left, 0);
  const right = buckets.reduce((sum, bucket) => sum + bucket.right, 0);
  const total = left + right;
  return { rows, left_pct: total ? roundPercent(left / total * 100) : null, right_pct: total ? roundPercent(right / total * 100) : null, total_datapoints: rows.reduce((sum, row) => sum + row.datapoints, 0) };
}

export function analyze(workouts: WorkoutSummary[], options: AnalysisOptions): AnalysisResult {
  if (!Number.isInteger(options.sample_seconds) || options.sample_seconds < 1) throw new RangeError('sample_seconds must be a positive integer');
  const selected = workouts.filter((workout) => workout.selected && !workout.error);
  let buckets = options.group_by === 'time' ? bucketByTime(selected, options) : bucketByPower(selected, options);
  if (options.group_by === 'power') {
    buckets = buckets.filter(({ range, count }) => (options.min_watts == null || range[1] > options.min_watts) && (options.max_watts == null || range[0] < options.max_watts) && count >= Math.max(options.min_datapoints, 1));
  } else buckets = buckets.filter(({ count }) => count >= Math.max(options.min_datapoints, 1));
  const summary = summarize(buckets, options.group_by, options.sample_seconds);
  const result: AnalysisResult = {
    total_datapoints: summary.total_datapoints,
    overall_left_pct: summary.left_pct,
    overall_right_pct: summary.right_pct,
    buckets: summary.rows,
    files_analyzed: selected.length,
    sample_seconds: options.sample_seconds,
    total_duration: formatDuration(summary.total_datapoints * options.sample_seconds),
  };
  if (options.group_by === 'power') result.bucket_size = options.bucket_size;
  else {
    result.time_bucket_minutes = options.time_bucket_minutes;
    if (options.min_watts != null || options.max_watts != null) result.watts_filter = [options.min_watts, options.max_watts];
  }
  if (!buckets.length) result.message = NO_BUCKETS;
  return result;
}