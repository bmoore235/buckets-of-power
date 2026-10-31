export type GroupBy = 'power' | 'time' | 'cadence';

export interface DataPoint {
  timestamp: number | null;
  power: number | null;
  leftRightBalance: number | null;
  cadence?: number | null;
  leftPowerPhase?: number[] | null;
  leftPowerPhasePeak?: number[] | null;
  rightPowerPhase?: number[] | null;
  rightPowerPhasePeak?: number[] | null;
}

export interface WorkoutSummary {
  id: string;
  name: string;
  date: string | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  averagePower: number | null;
  points: DataPoint[];
  hasBalance: boolean;
  selected: boolean;
  error?: string;
}

export interface AnalysisOptions {
  group_by: GroupBy;
  bucket_size: number;
  time_bucket_minutes: number;
  cadence_bucket_size: number;
  min_watts: number | null;
  max_watts: number | null;
  min_datapoints: number;
  sample_seconds: number;
  min_minute: number | null;
  max_minute: number | null;
}

export interface BucketRow {
  watts?: [number, number];
  minutes?: [number, number];
  rpm?: [number, number];
  avg_power: number | null;
  avg_cadence: number | null;
  left_pct: number | null;
  right_pct: number | null;
  datapoints: number;
  duration?: string;
}

export interface AnalysisResult {
  total_datapoints: number;
  overall_left_pct: number | null;
  overall_right_pct: number | null;
  buckets: BucketRow[];
  files_analyzed: number;
  sample_seconds: number;
  total_duration?: string;
  bucket_size?: number;
  time_bucket_minutes?: number;
  cadence_bucket_size?: number;
  watts_filter?: [number | null, number | null];
  message?: string;
}