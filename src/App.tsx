import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyze } from './analysis';
import About from './About.tsx';
import PowerPhaseChart, { describeFilter, type PinnedPhases } from './PowerPhaseChart';
import { computePhases } from './phases';
import { loadSampleWorkouts } from './sample';
import { loadStoredWorkouts, syncStoredWorkouts } from './storage';
import type { AnalysisOptions, AnalysisResult, GroupBy, WorkoutSummary } from './types';

const DEFAULTS: AnalysisOptions = {
  group_by: 'power', bucket_size: 25, time_bucket_minutes: 30, cadence_bucket_size: 10, min_watts: null, max_watts: null,
  min_datapoints: 30, sample_seconds: 1, min_minute: null, max_minute: null,
};
const NO_BUCKETS = 'No buckets matched. Records need power plus left/right balance (dual-sided power meter), and the watt range / min_datapoints filters may be too strict.';

function readOptionsFromHash(): AnalysisOptions {
  const params = new URLSearchParams(location.hash.slice(1));
  const number = (name: string, fallback: number | null, minimum = 0) => {
    const value = params.get(name);
    if (value == null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
  };
  return {
    group_by: params.get('group_by') === 'time' ? 'time' : params.get('group_by') === 'cadence' ? 'cadence' : DEFAULTS.group_by,
    bucket_size: number('bucket_size', DEFAULTS.bucket_size, 1)!,
    cadence_bucket_size: number('cadence_bucket_size', DEFAULTS.cadence_bucket_size, 1)!,
    time_bucket_minutes: number('time_bucket_minutes', DEFAULTS.time_bucket_minutes, 1)!,
    min_watts: number('min_watts', null), max_watts: number('max_watts', null),
    min_datapoints: number('min_datapoints', DEFAULTS.min_datapoints, 1)!, sample_seconds: number('sample_seconds', DEFAULTS.sample_seconds, 1)!,
    min_minute: number('min_minute', null), max_minute: number('max_minute', null),
  };
}

type AgentApi = {
  loadFiles: (files: File[]) => Promise<void>;
  setOptions: (options: Partial<AnalysisOptions>) => void;
  selectWorkouts: (ids: string[]) => void;
  drillDown: (axis: GroupBy, lo: number, hi: number) => void;
  getResult: () => AnalysisResult;
  getWorkouts: () => WorkoutSummary[];
};

declare global { interface Window { bucketsOfPower?: AgentApi } }

function formatDate(value: string | null) {
  if (!value) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
function formatDuration(seconds: number | null) {
  if (seconds == null) return '—';
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 3600)).padStart(2, '0')}:${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
function safeJson(value: unknown) { return JSON.stringify(value).replace(/</g, '\\u003c'); }

type ThemePreference = 'system' | 'light' | 'dark';

function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem('bop-theme');
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export default function App() {
  const [themePreference, setThemePreference] = useState<ThemePreference>(readThemePreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [workouts, setWorkouts] = useState<WorkoutSummary[]>([]);
  const [options, setOptionsState] = useState<AnalysisOptions>(readOptionsFromHash);
  const [trail, setTrail] = useState<AnalysisOptions[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Ready. Files are analyzed locally in this browser.');
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [showingSample, setShowingSample] = useState(true);
  const sampleActive = useRef(true);
  const [hydrated, setHydrated] = useState(false);
  const storedIds = useRef(new Set<string>());
  const writeQueue = useRef(Promise.resolve());
  const leaveSample = () => { sampleActive.current = false; setShowingSample(false); };
  const selectedCount = workouts.filter((workout) => workout.selected && !workout.error).length;
  const result = useMemo(() => analyze(workouts, options), [workouts, options]);
  const phases = useMemo(() => computePhases(workouts, options), [workouts, options]);
  const phaseLabel = describeFilter(options, workouts.filter((workout) => workout.selected && !workout.error).length);
  const [pinnedPhases, setPinnedPhases] = useState<PinnedPhases | null>(null);
  const darkMode = themePreference === 'system' ? systemPrefersDark : themePreference === 'dark';

  useEffect(() => {
    void (async () => {
      let stored: WorkoutSummary[] = [];
      try { stored = await loadStoredWorkouts(); } catch { /* Storage unavailable; continue without a cache. */ }
      if (stored.length) {
        // Keep anything loaded while hydrating, ahead of older cached rides.
        sampleActive.current = false;
        setShowingSample(false);
        storedIds.current = new Set(stored.map((workout) => workout.id));
        setWorkouts((current) => [...stored, ...current.filter((item) => !storedIds.current.has(item.id) && !item.id.startsWith('sample-'))]);
        setStatus(`Restored ${stored.length} saved ride${stored.length === 1 ? '' : 's'} from this browser.`);
      } else if (sampleActive.current) {
        const samples = await loadSampleWorkouts();
        if (sampleActive.current) {
          setWorkouts(samples);
          setStatus(`Showing ${samples.length} sample rides. Load your own FIT files to replace them.`);
        }
      }
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (!hydrated || showingSample) return;
    const persistable = workouts.filter((workout) => !workout.error);
    writeQueue.current = writeQueue.current.then(async () => {
      const previous = storedIds.current;
      try {
        await syncStoredWorkouts(persistable, previous);
        storedIds.current = new Set(persistable.map((workout) => workout.id));
      } catch { /* Cache is best-effort. */ }
    });
  }, [workouts, hydrated, showingSample]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updatePreference = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    setSystemPrefersDark(media.matches);
    media.addEventListener('change', updatePreference);
    return () => media.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    if (themePreference === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = themePreference;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor) themeColor.content = darkMode ? '#101713' : '#f5f7f4';
  }, [darkMode, themePreference]);

  const toggleTheme = () => {
    const next: ThemePreference = themePreference === 'system'
      ? (darkMode ? 'light' : 'dark')
      : themePreference === 'dark' ? 'light' : 'system';
    setThemePreference(next);
    try {
      if (next === 'system') localStorage.removeItem('bop-theme');
      else localStorage.setItem('bop-theme', next);
    } catch { /* Keep the current session preference. */ }
  };

  const themeAction = themePreference === 'light' ? 'Use system theme' : `Switch to ${darkMode ? 'light' : 'dark'} mode`;

  const setOptions = useCallback((next: Partial<AnalysisOptions>) => {
    setOptionsState((current) => ({ ...current, ...next }));
  }, []);

  const loadFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setLoading(true);
    setStatus(`Reading ${files.length} file${files.length === 1 ? '' : 's'} in a local worker…`);
    const input = files.map((file) => ({ id: crypto.randomUUID(), name: file.name, file, buffer: null as ArrayBuffer | null }));
    try {
      await Promise.all(input.map(async (item) => { item.buffer = await item.file.arrayBuffer(); }));
      const worker = new Worker(new URL('./workers/fit.worker.ts', import.meta.url), { type: 'module' });
      const parsed = await new Promise<Array<{ id: string; name: string; decoded?: { points: WorkoutSummary['points']; session: { durationSeconds: number | null; distanceMeters: number | null; averagePower: number | null } }; error?: string }>>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<typeof parsed>) => resolve(event.data);
        worker.onerror = (event) => reject(new Error(event.message || 'FIT worker failed.'));
        worker.postMessage({ files: input.map(({ id, name, buffer }) => ({ id, name, buffer: buffer! })) }, input.map(({ buffer }) => buffer!));
      });
      worker.terminate();
      const parsedById = new Map(parsed.map((entry) => [entry.id, entry]));
      const added = input.map(({ id, name }) => {
        const entry = parsedById.get(id)!;
        const points = entry.decoded?.points ?? [];
        const first = points.find((point) => point.timestamp != null)?.timestamp;
        return {
          id, name, points, hasBalance: points.some((point) => point.leftRightBalance != null),
          date: first == null ? null : new Date(first).toISOString(),
          durationSeconds: entry.decoded?.session.durationSeconds ?? null,
          distanceMeters: entry.decoded?.session.distanceMeters ?? null,
          averagePower: entry.decoded?.session.averagePower ?? null,
          selected: !entry.error, ...(entry.error ? { error: entry.error } : {}),
        } satisfies WorkoutSummary;
      });
      const replaceSample = sampleActive.current;
      leaveSample();
      setWorkouts((current) => replaceSample ? added : [...current, ...added]);
      const failed = added.filter((item) => item.error).length;
      setStatus(`${added.length - failed} file${added.length - failed === 1 ? '' : 's'} loaded${failed ? `; ${failed} file${failed === 1 ? '' : 's'} could not be parsed` : ''}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not load files.');
    } finally {
      setLoading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }, []);

  const drillDown = useCallback((axis: GroupBy, lo: number, hi: number) => {
    if (axis === 'cadence') return;
    setTrail((items) => [...items, options]);
    setOptionsState((current) => axis === 'power'
      ? { ...current, group_by: 'time', min_watts: lo, max_watts: hi, min_minute: null, max_minute: null }
      : { ...current, group_by: 'power', min_minute: lo, max_minute: hi });
    setStatus(axis === 'power' ? `Showing time buckets filtered to ${lo}–${hi} watts.` : `Showing power buckets for minutes ${lo}–${hi}.`);
  }, [options]);

  const getResult = useCallback(() => analyze(workouts, options), [workouts, options]);
  useEffect(() => {
    window.bucketsOfPower = {
      loadFiles,
      setOptions,
      selectWorkouts: (ids) => setWorkouts((items) => items.map((item) => ({ ...item, selected: ids.includes(item.id) && !item.error }))),
      drillDown,
      getResult,
      getWorkouts: () => workouts,
    };
    return () => { delete window.bucketsOfPower; };
  }, [loadFiles, setOptions, drillDown, getResult, workouts]);

  useEffect(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) if (value != null && value !== DEFAULTS[key as keyof AnalysisOptions]) params.set(key, String(value));
    const hash = params.toString();
    if (location.hash.slice(1) !== hash) history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
  }, [options]);

  const changeOption = (key: keyof AnalysisOptions, raw: string) => {
    if (key === 'group_by') { setOptions({ group_by: raw as GroupBy }); return; }
    const optional = key === 'min_watts' || key === 'max_watts' || key === 'min_minute' || key === 'max_minute';
    if (raw === '') {
      if (optional) setOptions({ [key]: null } as Partial<AnalysisOptions>);
      return;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < (optional ? 0 : 1)) return;
    setOptions({ [key]: value } as Partial<AnalysisOptions>);
  };
  const removeWorkout = (id: string) => setWorkouts((items) => items.filter((item) => item.id !== id));
  const selectAll = (selected: boolean) => setWorkouts((items) => items.map((item) => ({ ...item, selected: selected && !item.error })));
  const back = () => {
    const previous = trail.at(-1);
    if (!previous) return;
    setOptionsState(previous);
    setTrail((items) => items.slice(0, -1));
    setStatus('Returned to the previous analysis view.');
  };
  const clearDrill = () => {
    setOptionsState({ ...options, ...DEFAULTS, min_minute: null, max_minute: null });
    setTrail([]);
    setStatus('Drill-down cleared.');
  };
  const exportCsv = () => {
    const axis = options.group_by === 'power' ? 'watts' : options.group_by === 'cadence' ? 'rpm' : 'minutes';
    const lines = [['range_start', 'range_end', 'left_pct', 'right_pct', 'avg_power', 'avg_cadence', 'datapoints', 'duration'], ...result.buckets.map((row) => {
      const range = row[axis];
      return [range?.[0], range?.[1], row.left_pct, row.right_pct, row.avg_power, row.avg_cadence, row.datapoints, row.duration];
    })].map((row) => row.map((cell) => cell == null ? '' : String(cell)).join(','));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'buckets-of-power.csv'; anchor.click(); URL.revokeObjectURL(url);
  };
  const copyJson = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(result, null, 2)); setStatus('Analysis JSON copied to clipboard.'); }
    catch { setStatus('Clipboard access is unavailable in this browser.'); }
  };
  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault(); setDragging(false); void loadFiles(Array.from(event.dataTransfer.files));
  };

  const bucketKey = options.group_by === 'power' ? 'bucket_size' : options.group_by === 'cadence' ? 'cadence_bucket_size' : 'time_bucket_minutes';
  const bucketValue = options[bucketKey];

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="topbar">
      <a className="brand" href="#" aria-label="BucketsOfPower home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>Buckets<span className="brand-light">OfPower</span></span></a>
      <div className="topbar-right"><button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={themeAction} title={themeAction}><span aria-hidden="true">{darkMode ? '☀' : '☾'}</span><span className="theme-toggle-label">{themePreference === 'light' ? 'System' : `${darkMode ? 'Light' : 'Dark'} mode`}</span></button><span className="local-badge"><span className="live-dot" />100% local</span><span className="header-caption">Power balance, made visible.</span></div>
    </header>

    <div className="workspace">
      <aside className="sidebar" aria-label="Workout files">
        <div className="section-heading"><div><p className="eyebrow">YOUR LIBRARY</p><h2>Workouts <span className="count-pill">{workouts.length}</span></h2>{showingSample && workouts.length > 0 && <p className="sample-note">Sample data. Loading your files replaces it.</p>}</div><button className="icon-button" data-testid="remove-all" aria-label="Remove all workouts" title="Remove all" disabled={!workouts.length} onClick={() => { leaveSample(); setWorkouts([]); }}>×</button></div>
        <div className={`dropzone ${dragging ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
          <div className="upload-icon" aria-hidden="true">↑</div><strong>Drop your FIT files here</strong><span>or choose files from your device</span>
          <label className="button button-primary upload-button" htmlFor="fit-upload">Choose files</label>
          <input id="fit-upload" data-testid="fit-upload" type="file" accept=".fit,.gz,.fit.gz" multiple aria-label="Choose FIT files" onChange={(event) => void loadFiles(Array.from(event.target.files ?? []))} />
          <small>FIT and FIT.GZ · processed on this device</small>
        </div>
        <div className="library-tools"><span>{selectedCount} selected</span><div><button className="text-button" data-testid="select-all" onClick={() => selectAll(true)}>Select all</button><span className="tool-divider">·</span><button className="text-button" data-testid="clear-selection" onClick={() => selectAll(false)}>Clear</button></div></div>
        <div className="workout-list">
          {!workouts.length && <div className="library-empty"><div className="empty-stack" aria-hidden="true"><span /><span /><span /></div><strong>Your rides live here</strong><p>Load one or more FIT files to start exploring your left/right power balance.</p></div>}
          {workouts.map((workout) => <article className={`workout-card ${workout.error ? 'has-error' : ''}`} key={workout.id} onClick={(event) => { if (!workout.error && !(event.target as HTMLElement).closest('button, input, label')) setWorkouts((items) => items.map((item) => item.id === workout.id ? { ...item, selected: !item.selected } : item)); }}>
            <div className="workout-card-top"><label className="check-wrap"><input type="checkbox" data-testid="workout-checkbox" data-workout-id={workout.id} aria-label={`Include ${workout.name}`} checked={workout.selected} disabled={!!workout.error} onChange={(event) => setWorkouts((items) => items.map((item) => item.id === workout.id ? { ...item, selected: event.target.checked } : item))} /><span className="custom-check" /></label><div className="workout-name"><strong>{formatDate(workout.date)}</strong><span title={workout.name}>{workout.name}</span></div><button className="icon-button card-remove" data-testid="remove-workout" aria-label={`Remove ${workout.name}`} onClick={() => removeWorkout(workout.id)}>×</button></div>
            {workout.error ? <p className="error-copy">Could not parse: {workout.error}</p> : <><div className="workout-stats"><div><span>Duration</span><strong>{formatDuration(workout.durationSeconds)}</strong></div><div><span>Distance</span><strong>{workout.distanceMeters == null ? '—' : `${(workout.distanceMeters / 1000).toFixed(1)} km`}</strong></div><div><span>Avg power</span><strong>{workout.averagePower == null ? '—' : `${Math.round(workout.averagePower)} W`}</strong></div></div>{!workout.hasBalance && <span className="no-balance">No L/R data</span>}</>}
          </article>)}
        </div>
        <div className="sidebar-footer"><span className="lock-icon" aria-hidden="true">▣</span><span>Your files never leave this browser.</span></div>
      </aside>

      <main className="main-panel" id="main-content" tabIndex={-1}>
        <div className="main-heading"><div><p className="eyebrow">POWER BALANCE ANALYZER</p><h1>Find your balance.</h1><p className="lead">See how your left and right legs share the work across every ride.</p></div><div className="heading-spark" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div></div>
        <section className="control-panel" aria-label="Analysis options">
          <div className="control-top"><div className="mode-control"><span className="control-label">GROUP BY</span><div className="segmented" role="group" aria-label="Group by"><button type="button" data-testid="group-by-power" aria-label="Group by power" aria-pressed={options.group_by === 'power'} className={options.group_by === 'power' ? 'active' : ''} onClick={() => changeOption('group_by', 'power')}>Power</button><button type="button" data-testid="group-by-time" aria-label="Group by time" aria-pressed={options.group_by === 'time'} className={options.group_by === 'time' ? 'active' : ''} onClick={() => changeOption('group_by', 'time')}>Time</button><button type="button" data-testid="group-by-cadence" aria-label="Group by cadence" aria-pressed={options.group_by === 'cadence'} className={options.group_by === 'cadence' ? 'active' : ''} onClick={() => changeOption('group_by', 'cadence')}>Cadence</button></div></div>
            <div className="filter-controls">
              <NumberControl label="Min watts" testId="min-watts" value={options.min_watts} onChange={(value) => changeOption('min_watts', value)} unit="W" />
              <NumberControl label="Max watts" testId="max-watts" value={options.max_watts} onChange={(value) => changeOption('max_watts', value)} unit="W" />
              <NumberControl label={options.group_by === 'power' ? 'Bucket size' : options.group_by === 'cadence' ? 'Cadence bucket' : 'Time bucket'} testId="bucket-size" value={bucketValue} onChange={(value) => changeOption(bucketKey, value)} unit={options.group_by === 'power' ? 'W' : options.group_by === 'cadence' ? 'rpm' : 'min'} min={1} />
              <NumberControl label="Min datapoints" testId="min-datapoints" value={options.min_datapoints} onChange={(value) => changeOption('min_datapoints', value)} min={1} />
              <NumberControl label="Seconds / point" testId="sample-seconds" value={options.sample_seconds} onChange={(value) => changeOption('sample_seconds', value)} unit="s" min={1} />
            </div>
          </div>
          {(options.min_minute != null || options.max_minute != null) && <div className="time-filter-note">Time window: {options.min_minute ?? 0}–{options.max_minute ?? 'end'} min <button className="text-button" onClick={() => setOptions({ min_minute: null, max_minute: null })}>Remove</button></div>}
        </section>

        {trail.length > 0 && <div className="drill-bar"><span className="drill-icon" aria-hidden="true">↳</span><span><strong>{trail.at(-1)?.group_by === 'power' ? `Power ${options.min_watts ?? 0}–${options.max_watts ?? '∞'} W` : `Time ${options.min_minute ?? 0}–${options.max_minute ?? '∞'} min`}</strong> <span className="drill-context">grouped by {options.group_by}</span></span><div className="drill-actions"><button className="text-button" data-testid="drill-back" onClick={back}>← Back</button><button className="text-button" data-testid="drill-clear" onClick={clearDrill}>Clear</button></div></div>}

        <PowerPhaseChart phases={phases} label={phaseLabel} pinned={pinnedPhases} onPin={() => setPinnedPhases({ phases, label: phaseLabel })} onUnpin={() => setPinnedPhases(null)} />

        <section className="results-section" aria-label="Power balance results">
          <div className="results-header"><div><p className="eyebrow">ANALYSIS</p><h2>Your power split</h2></div><div className="export-actions"><button className="button button-quiet" data-testid="copy-json" onClick={() => void copyJson()}>Copy JSON</button><button className="button button-quiet" data-testid="download-csv" onClick={exportCsv}>↓ CSV</button></div></div>
          <div className="summary-card"><div className="balance-total"><div className="balance-numbers"><div><span className="leg-dot left-dot" />Left <strong>{result.overall_left_pct == null ? '—' : `${result.overall_left_pct.toFixed(2)}%`}</strong></div><div><span className="leg-dot right-dot" />Right <strong>{result.overall_right_pct == null ? '—' : `${result.overall_right_pct.toFixed(2)}%`}</strong></div></div><div className="split-bar" role="img" aria-label={`Overall balance: ${result.overall_left_pct ?? 0}% left and ${result.overall_right_pct ?? 0}% right`}><span style={{ width: `${result.overall_left_pct ?? 50}%` }} /><span style={{ width: `${result.overall_right_pct ?? 50}%` }} /></div></div><div className="summary-divider" /><div className="summary-stat"><span>DATAPOINTS</span><strong>{result.total_datapoints.toLocaleString()}</strong></div><div className="summary-stat"><span>RIDES USED</span><strong>{result.files_analyzed}</strong></div><div className="summary-stat"><span>TOTAL TIME</span><strong>{formatDuration(result.total_datapoints * options.sample_seconds)}</strong></div></div>


          <div className="table-heading"><div><h3>{options.group_by === 'power' ? 'Balance by power' : options.group_by === 'cadence' ? 'Balance by cadence' : 'Balance by elapsed time'}</h3><span>{result.buckets.length ? (options.group_by === 'cadence' ? 'Average power per cadence bucket' : 'Select a bucket row to explore') : 'Waiting for matching samples'}</span></div><div className="legend"><span><i className="left-dot" />Left</span><span><i className="right-dot" />Right</span></div></div>
          <div className="table-wrap"><table aria-label="Power balance buckets"><thead><tr><th scope="col">{options.group_by === 'power' ? 'POWER RANGE' : options.group_by === 'cadence' ? 'CADENCE RANGE' : 'ELAPSED TIME'}</th><th scope="col">LEFT</th><th scope="col">BALANCE</th><th scope="col">RIGHT</th>{options.group_by !== 'power' && <th scope="col">AVG POWER</th>}{options.group_by !== 'cadence' && <th scope="col">AVG CADENCE</th>}<th scope="col">POINTS</th><th scope="col">DURATION</th></tr></thead><tbody>
            {result.buckets.map((row) => { const range = row[options.group_by === 'power' ? 'watts' : options.group_by === 'cadence' ? 'rpm' : 'minutes']!; const lo = range[0]; const hi = range[1]; const unreliable = row.datapoints < Math.max(options.min_datapoints * 1.5, 10); const leftBalance = row.left_pct == null ? 'unavailable' : `${row.left_pct.toFixed(2)}%`; const rightBalance = row.right_pct == null ? 'unavailable' : `${row.right_pct.toFixed(2)}%`; const drill = () => drillDown(options.group_by, lo, hi); return <tr key={`${lo}-${hi}`} data-testid="bucket-row" data-bucket-lo={lo} data-bucket-hi={hi} data-axis={options.group_by} className={`bucket-row${unreliable ? ' is-unreliable' : ''}`} tabIndex={options.group_by === 'cadence' ? undefined : 0} aria-label={options.group_by === 'cadence' ? undefined : `Show ${options.group_by === 'power' ? 'elapsed-time' : 'power'} buckets for ${lo} to ${hi} ${options.group_by === 'power' ? 'watts' : 'minutes'}`} onClick={drill} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); drill(); } }}>
              <th scope="row">{options.group_by === 'power' ? `${lo}–${hi} W` : options.group_by === 'cadence' ? `${lo}–${hi} rpm` : `${lo}–${hi} min`}</th><td className="pct-cell left-text">{row.left_pct == null ? '—' : `${row.left_pct.toFixed(2)}%`}</td><td><div className="mini-bar" role="img" aria-label={`Left balance ${leftBalance}; right balance ${rightBalance}`}><span style={{ width: `${row.left_pct ?? 50}%` }} /><span style={{ width: `${row.right_pct ?? 50}%` }} /></div></td><td className="pct-cell right-text">{row.right_pct == null ? '—' : `${row.right_pct.toFixed(2)}%`}</td>{options.group_by !== 'power' && <td className="points-cell">{row.avg_power == null ? '—' : `${row.avg_power.toFixed(1)} W`}</td>}{options.group_by !== 'cadence' && <td className="points-cell">{row.avg_cadence == null ? '—' : `${row.avg_cadence.toFixed(1)} rpm`}</td>}<td className="points-cell">{row.datapoints.toLocaleString()} {unreliable && <span className="unreliable-dot" title="Few datapoints; treat as less reliable" aria-label="Few datapoints" />}</td><td className="duration-cell">{row.duration}</td>
            </tr>; })}
            {!result.buckets.length && <tr className="empty-row"><td colSpan={7}><div className="table-empty"><div className="empty-chart" aria-hidden="true"><span /><span /><span /><span /><span /></div><strong>{result.message ?? NO_BUCKETS}</strong><span>Try selecting rides with dual-sided power data, or adjust the filters.</span></div></td></tr>}
          </tbody></table></div>
          <p className="table-note"><span className="unreliable-dot" /> Buckets with few samples may be less reliable.</p>
        </section>
        <details className="agent-panel"><summary>For AI agents</summary><p>Upload files through <code>#fit-upload</code>. Read the current MCP-shaped analysis from <code>#bop-state</code> or call <code>window.bucketsOfPower.getResult()</code>. Options are shareable in the URL hash; local file selection is not.</p><p>Available browser methods: <code>loadFiles(File[])</code>, <code>setOptions(options)</code>, <code>selectWorkouts(ids)</code>, <code>drillDown(axis, lo, hi)</code>, <code>getResult()</code>, and <code>getWorkouts()</code>.</p></details>
      </main>
    </div>
    <About />
    <footer className="page-footer"><span>BUCKETS OF POWER <span>·</span></span><span>Made for the miles that matter.</span></footer>
    <div className="sr-only" role="status" aria-live="polite" data-testid="status">{loading ? 'Loading files. ' : ''}{status}</div>
    <script id="bop-state" type="application/json" dangerouslySetInnerHTML={{ __html: safeJson(result) }} />
  </div>;
}

function NumberControl({ label, testId, value, onChange, unit, min = 0 }: { label: string; testId: string; value: number | null; onChange: (value: string) => void; unit?: string; min?: number }) {
  return <label className="number-control"><span>{label}</span><div><input type="number" min={min} step="1" value={value ?? ''} data-testid={testId} onChange={(event) => onChange(event.target.value)} />{unit && <span className="input-unit">{unit}</span>}</div></label>;
}