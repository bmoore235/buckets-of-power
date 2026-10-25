import { decompressSync } from 'fflate';
import { Decoder, Stream, type FitMessages, type RecordMesg, type SessionMesg } from '@garmin/fitsdk';
import type { DataPoint } from '../types';

export interface DecodedWorkout {
  points: DataPoint[];
  session: { durationSeconds: number | null; distanceMeters: number | null; averagePower: number | null };
}

async function inflateIfGzip(input: Uint8Array): Promise<Uint8Array> {
  if (input[0] !== 0x1f || input[1] !== 0x8b) return input;
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
      const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Some browsers reject a valid gzip stream via DecompressionStream; fflate is the fallback.
    }
  }
  return decompressSync(input);
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function decodeFit(input: ArrayBuffer | Uint8Array): Promise<DecodedWorkout> {
  const compressedBytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const bytes = await inflateIfGzip(compressedBytes);
  const stream = Stream.fromByteArray(bytes);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) throw new Error('File is not a valid FIT file.');
  if (!decoder.checkIntegrity()) throw new Error('FIT file failed its integrity check.');
  const { messages, errors } = decoder.read({ mergeHeartRates: false, convertTypesToStrings: false });
  if (errors.length) throw new Error(errors.map((error) => error.message).join('; '));
  const messagesTyped = messages as FitMessages & { recordMesgs?: RecordMesg[]; sessionMesgs?: SessionMesg[] };
  const points = (messagesTyped.recordMesgs ?? []).map((record) => ({
    timestamp: record.timestamp instanceof Date ? record.timestamp.getTime() : null,
    power: numeric(record.power),
    // FIT's leftRightBalance field is the raw encoded byte (bit 7 identifies the right share).
    leftRightBalance: numeric(record.leftRightBalance),
    distance: numeric(record.distance),
    heartRate: numeric(record.heartRate),
    cadence: numeric(record.cadence),
  }));
  const session = messagesTyped.sessionMesgs?.at(-1);
  const timestamped = points.filter((point) => point.timestamp != null);
  const first = timestamped[0];
  const last = timestamped.at(-1);
  const powered = points.flatMap((point) => point.power == null ? [] : [point.power]);
  return {
    points,
    session: {
      durationSeconds: numeric(session?.totalTimerTime) ?? (first?.timestamp != null && last?.timestamp != null ? Math.max(0, (last.timestamp - first.timestamp) / 1000) : null),
      distanceMeters: numeric(session?.totalDistance) ?? last?.distance ?? null,
      averagePower: numeric(session?.avgPower) ?? (powered.length ? powered.reduce((sum, value) => sum + value, 0) / powered.length : null),
    },
  };
}

export function hasGzipMagic(bytes: Uint8Array) {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}