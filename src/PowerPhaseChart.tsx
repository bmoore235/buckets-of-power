import type { Arc, PhaseResult, SidePhase } from './phases';
import type { AnalysisOptions } from './types';

const SIZE = 160;
const C = SIZE / 2;
const R = 58;

const point = (deg: number, r = R) => {
  const a = (deg - 90) * Math.PI / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
};

function arcPath({ start, end }: Arc, r = R) {
  const sweep = ((end - start) % 360 + 360) % 360;
  const [x1, y1] = point(start, r);
  const [x2, y2] = point(end, r);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const fmt = (arc: Arc) => `${Math.round(arc.start)}° to ${Math.round(arc.end)}°`;

function Dial({ side, data }: { side: 'left' | 'right'; data: SidePhase | null }) {
  const label = side === 'left' ? 'Left' : 'Right';
  const description = data
    ? `${label} power phase ${fmt(data.phase)}, peak power phase ${fmt(data.peak)}, from ${data.samples.toLocaleString()} samples`
    : `${label} power phase unavailable`;
  return (
    <figure className={`phase-dial phase-${side}`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={description}>
        <circle cx={C} cy={C} r={R} className="phase-track" />
        {data && <path d={arcPath(data.phase)} className="phase-arc" />}
        {data && <path d={arcPath(data.peak, R)} className="phase-peak" />}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => { const [x1, y1] = point(deg, 34); const [x2, y2] = point(deg, 43); return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} className="phase-tick" />; })}
        <text x={C} y={C} dominantBaseline="central" className="phase-side">{label.toUpperCase()}</text>
      </svg>
      <figcaption>
        {data ? <><span>Phase {fmt(data.phase)}</span><span>Peak {fmt(data.peak)}</span></> : <span>No phase data</span>}
      </figcaption>
    </figure>
  );
}

export interface PinnedPhases { phases: PhaseResult; label: string }

export function describeFilter(options: AnalysisOptions, rides: number): string {
  const parts: string[] = [];
  if (options.min_watts != null || options.max_watts != null) parts.push(`${options.min_watts ?? 0}–${options.max_watts ?? '∞'} W`);
  if (options.min_minute != null || options.max_minute != null) parts.push(`${options.min_minute ?? 0}–${options.max_minute ?? 'end'} min`);
  parts.push(`${rides} ${rides === 1 ? 'ride' : 'rides'}`);
  return parts.join(' · ');
}

function DialRow({ title, phases }: { title: string; phases: PhaseResult }) {
  return (
    <div className="phase-row" role="group" aria-label={title}>
      <p className="phase-row-title">{title}</p>
      <div className="phase-dials"><Dial side="left" data={phases.left} /><Dial side="right" data={phases.right} /></div>
    </div>
  );
}

interface Props { phases: PhaseResult; label: string; pinned: PinnedPhases | null; onPin: () => void; onUnpin: () => void }

export default function PowerPhaseChart({ phases, label, pinned, onPin, onUnpin }: Props) {
  if (!phases.left && !phases.right && !pinned) return null;
  return (
    <section className="phase-section" aria-label="Power phase">
      <div className="table-heading"><div><h3>Power phase</h3><span>Average pedal-stroke arc, clockwise from top dead centre</span></div><div className="legend"><span><i className="phase-key-arc" />Phase</span><span><i className="phase-key-peak" />Peak power</span>{pinned ? <button type="button" className="text-button" onClick={onUnpin}>Unpin</button> : <button type="button" className="text-button" onClick={onPin} disabled={!phases.left && !phases.right}>Pin to compare</button>}</div></div>
      <div className="phase-compare">
        <DialRow title={pinned ? `Current: ${label}` : label} phases={phases} />
        {pinned && <DialRow title={`Pinned: ${pinned.label}`} phases={pinned.phases} />}
      </div>
    </section>
  );
}
