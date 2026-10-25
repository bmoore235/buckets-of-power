import { describe, expect, it } from 'vitest';
import { analyze, bucketByPower, bucketByTime, decodeBalance } from '../src/analysis';
import type { AnalysisOptions, DataPoint, WorkoutSummary } from '../src/types';

const options: AnalysisOptions = {
  group_by: 'power', bucket_size: 25, time_bucket_minutes: 30, min_watts: null, max_watts: null,
  min_datapoints: 1, sample_seconds: 1, min_minute: null, max_minute: null,
};
function point(power: number | null, balance: number | null, seconds = 0): DataPoint {
  return { timestamp: Date.UTC(2026, 0, 1) + seconds * 1000, power, leftRightBalance: balance };
}
function workout(points: DataPoint[]): WorkoutSummary {
  return { id: 'ride', name: 'ride.fit', date: null, durationSeconds: null, distanceMeters: null, averagePower: null, points, hasBalance: true, selected: true };
}

describe('decodeBalance', () => {
  it('decodes the low seven bits as left share when bit 7 is clear', () => {
    expect(decodeBalance(48, 200)).toEqual({ left_pct: 48, right_pct: 52, left_watts: 96, right_watts: 104 });
  });
  it('decodes the low seven bits as right share when bit 7 is set', () => {
    expect(decodeBalance(0x80 | 48)).toEqual({ left_pct: 52, right_pct: 48 });
  });
});

describe('power buckets', () => {
  it('uses lower-inclusive upper-exclusive boundaries and skips unusable samples', () => {
    const ride = workout([point(249, 50), point(250, 50), point(null, 50), point(100, null), point(-1, 50)]);
    const buckets = bucketByPower([ride], options);
    expect(buckets.find((bucket) => bucket.range[0] === 225)?.count).toBe(1);
    expect(buckets.find((bucket) => bucket.range[0] === 250)?.count).toBe(1);
  });
  it('applies the watt range to overlapping buckets and filters empty rows', () => {
    const ride = workout([point(240, 50), point(60, 50), point(310, 40)]);
    const result = analyze([ride], { ...options, min_watts: 230, max_watts: 250 });
    expect(result.buckets.map((row) => row.watts)).toEqual([[225, 250]]);
    expect(result.total_datapoints).toBe(1);
  });
  it('filters by time window per sample when drilling down to power', () => {
    const ride = workout([point(210, 50, 0), point(210, 50, 60), point(210, 50, 120)]);
    const buckets = bucketByPower([ride], { ...options, min_minute: 1, max_minute: 2 });
    expect(buckets.filter((bucket) => bucket.count > 0).map((bucket) => bucket.count)).toEqual([1]);
  });
  it('returns the Python-compatible no-buckets message for missing balance', () => {
    const ride = workout([point(200, null)]);
    const result = analyze([ride], options);
    expect(result.message).toContain('No buckets matched.');
    expect(result.total_datapoints).toBe(0);
  });
});

describe('time buckets', () => {
  it('starts a separate elapsed-time clock for each workout and filters power per sample', () => {
    const first = workout([point(220, 50, 0), point(240, 50, 1800), point(250, 50, 3600)]);
    const second = { ...workout([point(220, 50, 10000)]), id: 'second' };
    const buckets = bucketByTime([first, second], { ...options, time_bucket_minutes: 30, min_watts: 225, max_watts: 250 });
    expect(buckets.map(({ range, count }) => [range, count])).toEqual([[[30, 60], 1]]);
  });
  it('summarizes included samples and durations', () => {
    const result = analyze([workout([point(200, 50), point(200, 0)])], { ...options, min_datapoints: 2, sample_seconds: 3 });
    expect(result.buckets[0]).toMatchObject({ watts: [200, 225], left_pct: 25, right_pct: 75, datapoints: 2, duration: '00:00:06' });
    expect(result.overall_left_pct).toBe(25);
    expect(result.total_duration).toBe('00:00:06');
  });
});