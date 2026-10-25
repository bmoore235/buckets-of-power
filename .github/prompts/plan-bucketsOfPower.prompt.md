## Plan: BucketsOfPower.com, a client-only FIT power-balance analyzer

A static React and TypeScript single-page app, built with Vite and deployable to any static host. It ports the Python analysis in [/Users/brendanmoore/Github/trainingpeaks-mcp/src/tp_mcp/fit/power_balance.py](/Users/brendanmoore/Github/trainingpeaks-mcp/src/tp_mcp/fit/power_balance.py) and [/Users/brendanmoore/Github/trainingpeaks-mcp/src/tp_mcp/fit/parser.py](/Users/brendanmoore/Github/trainingpeaks-mcp/src/tp_mcp/fit/parser.py) to TypeScript. The FIT files are parsed, analysed and discarded in the browser, with no backend or network calls.

**Behaviour to port**

These come from the Python code and must be matched exactly:
- **Left/right decode** (`decode_left_right_balance`): use the raw `left_right_balance` byte. The low 7 bits are the percentage. If bit 7 is set, the percentage is the right share, otherwise it is the left share. Left and right watts equal power × share.
- **Usable samples:** a sample needs power ≥ 0, a decoded left/right split and, for time mode, a timestamp. All other samples are skipped.
- **Power buckets** (`bucket_left_right_power`):
  - Buckets are lower-inclusive and upper-exclusive.
  - Empty buckets are created from 0 up to the highest used bucket, then removed by the min-datapoints filter.
  - The min/max watts filter keeps buckets that overlap `[min, max)` (`filter_power_buckets`).
- **Time buckets** (`bucket_left_right_time`):
  - The bucket index is whole bucket-widths since each ride's own first timestamp.
  - The min/max watts filter applies per sample, with `min <= power < max`.
  - Rows are keyed `[startMin, endMin]`.
- **Row output** (`summarize_power_buckets`):
  - left% and right% are each bucket's share of left plus right watts, to 2 decimals, or null if the total is 0.
  - Duration is datapoints × seconds per datapoint, shown as HH:MM:SS.
  - The overall left/right figure is computed over all included buckets.
- **Seconds per datapoint:** the default is 1, as you specified. The Python `infer_sample_seconds` (median timestamp gap) is not needed.

**Steps**

*Phase 1: Scaffold and core library (no UI dependency)*
1. Create the repo with Vite, React and TypeScript, Vitest, and Playwright for end-to-end tests. Add a strict Content-Security-Policy meta tag with `connect-src 'none'`, so the "nothing leaves your browser" claim is enforced rather than just stated.
2. Build `/Users/brendanmoore/Github/trainingpeaks-mcp/lib/fit/decode.ts`:
   - Use the official `@garmin/fitsdk` decoder, which runs in the browser. Alternatively use `fit-file-parser`, to be settled at the start of this step.
   - Detect gzip by the `1f 8b` magic bytes and decompress with the native `DecompressionStream`, with `fflate` as a fallback. This handles both `.fit` and `.fit.gz`, since TrainingPeaks downloads are gzipped.
   - Decode the `record` messages into a `DataPoint` type: timestamp, power, raw left/right balance, distance, and optionally heart rate and cadence.
   - Make sure the raw balance byte is exposed, not a scaled value. Check this against a real file.
3. Build `/Users/brendanmoore/Github/trainingpeaks-mcp/lib/fit/summary.ts`. For the sidebar, take the values from the final record: duration is the last timestamp minus the first, and distance is the last `distance`.
   - Average power should be the mean of all power samples, and the same value drives the sidebar. This avoids the `accumulated_power` field, which wraps at 65535.
   - Prefer the FIT `session` message (`avg_power`, `total_distance`, `total_timer_time`) when present, falling back to the records.
4. Build `/Users/brendanmoore/Github/trainingpeaks-mcp/lib/analysis/` as pure functions, ported 1:1 from the Python above:
   - `decodeBalance`, `bucketByPower`, `bucketByTime`, `filterBuckets`, `summarize`
   - `analyze(workouts, options)`, which returns the same JSON shape as the MCP tool: `total_datapoints`, `overall_left_pct`, `overall_right_pct`, `buckets[]`, `files_analyzed`, `sample_seconds`, and `message` when no buckets match.
5. Port the Python tests ([/Users/brendanmoore/Github/trainingpeaks-mcp/tests/test_tools/test_power_balance.py](/Users/brendanmoore/Github/trainingpeaks-mcp/tests/test_tools/test_power_balance.py)) to Vitest. Generate golden outputs from the Python implementation for 2-3 real or synthetic FIT files. Compare the results with the TypeScript output to prove parity. *Depends on 2 to 4.*

*Phase 2: State and drill-down logic*
6. Hold app state in one store (Zustand or `useReducer`): the loaded workouts with a selected flag, `groupBy` (power or time), `bucketSize` (default 25), `timeBucketMinutes` (default 30), `minWatts`, `maxWatts`, `minDatapoints` (default 30 to match the skill, which can be changed), and `sampleSeconds` (default 1).
7. Build row-click drill-down:
   - Clicking a power row `[lo, hi]` sets `groupBy` to time and sets `minWatts` to `lo` and `maxWatts` to `hi`.
   - Clicking a time row `[a, b]` sets `groupBy` to power and adds a time-window filter of `[a, b]` minutes. This needs a new `minMinute/maxMinute` filter on the power path, applied per sample and not present in the Python.
   - Show a breadcrumb or chip such as "Power 225-250 W, grouped by time", with a Clear and Back control, so the drill-down state is visible and reversible.
   - Keep the filter inputs editable after a drill-down.
   - *Depends on 4 and 6.*
8. Sync state to the URL hash or query string, using the same parameter names as the analysis options: `group_by`, `bucket_size`, `min_watts`, and so on. A drill-down state can then be shared or reproduced by an agent. Selected workouts cannot be encoded, because the data is local.

*Phase 3: UI* (*parallel with Phase 2 after step 4*)
9. Layout: a left sidebar and a main panel, with a header carrying the BucketsOfPower name and a "100% local" badge.
10. Add a drop zone and file input that accept multiple files with `accept=".fit,.gz,.fit.gz"`. Parse files in a Web Worker so the UI stays responsive, and show a per-file error state for corrupt files.
11. Add a scrollable sidebar workout list, with each card showing the following:
    - Filename and date.
    - Duration, distance (km, with a unit toggle if wanted) and average power.
    - A checkbox to include the ride in the analysis.
    - A badge for "no L/R data", so users can see why a ride contributes nothing.
    - A remove button.
    - "Select all" and "Clear" controls.
12. Main panel:
    - A group-by toggle (Power, Time).
    - Filter inputs for min/max watts, bucket size (watts or minutes depending on mode), min datapoints, and seconds per datapoint.
    - A summary line with the overall L/R and the number of rides used.
    - A table with columns for range, left%, right%, a split bar, datapoints and duration. Rows are clickable and keyboard-activatable.
    - An empty-state message that mirrors the Python "No buckets matched" text.
    - Visually flag buckets with few datapoints, as unreliable.
    - Copy-as-JSON and Download CSV buttons.
13. Style with plain CSS or Tailwind, and meet accessibility basics: labels, focus order, and ARIA table semantics.

*Phase 4: Agent friendliness*
14. Make the page drivable by DOM-based agents:
    - Make the file input always present in the DOM, never hidden behind a click handler, and give it a stable `id` and `data-testid="fit-upload"`. Agents using Playwright's `setInputFiles` or similar then work without a native file dialog.
    - Give every control a stable `data-testid`, a visible label and an `aria-label`: group-by, min/max watts, bucket size, seconds per datapoint, min datapoints, workout checkboxes and table rows.
    - Give each table row `data-bucket-lo`, `data-bucket-hi` and `data-axis` attributes.
    - Put an `aria-live` status region on the page announcing "N files loaded", errors and drill-down changes.
15. Expose machine-readable state:
    - Render a `<script type="application/json" id="bop-state">` block with the current analysis result in the same shape as the MCP tool output.
    - Expose `window.bucketsOfPower` with `loadFiles(File[])`, `setOptions(opts)`, `selectWorkouts(ids)`, `drillDown(axis, lo, hi)`, `getResult()` and `getWorkouts()`, all running in-browser only.
    - Optionally register the same operations as WebMCP tools through `navigator.modelContext`, feature-detected and a no-op when absent.
16. Publish discovery content so agents know how to use the site:
    - `/Users/brendanmoore/Github/trainingpeaks-mcp/llms.txt` and `/Users/brendanmoore/Github/trainingpeaks-mcp/agents.md` describing the upload input selector, the options, the URL parameters and the JS API.
    - A "For AI agents" page or collapsible panel with the same content.
    - A `/Users/brendanmoore/Github/trainingpeaks-mcp/README.md` section covering the privacy guarantee.


**Relevant files (reference only, in this repo)**
- [/Users/brendanmoore/Github/trainingpeaks-mcp/src/tp_mcp/fit/parser.py](/Users/brendanmoore/Github/trainingpeaks-mcp/src/tp_mcp/fit/parser.py): `decode_left_right_balance`, `WorkoutDataPoint` and `load_workout` define the fields to read from `record` messages.
- [/Users/brendanmoore/Github/trainingpeaks-mcp/src/tp_mcp/fit/power_balance.py](/Users/brendanmoore/Github/trainingpeaks-mcp/src/tp_mcp/fit/power_balance.py): `bucket_left_right_power`, `bucket_left_right_time`, `filter_*` and `summarize_power_buckets` are the logic to port.
- [/Users/brendanmoore/Github/trainingpeaks-mcp/src/tp_mcp/tools/power_balance.py](/Users/brendanmoore/Github/trainingpeaks-mcp/src/tp_mcp/tools/power_balance.py): `_validate_options` gives the input rules, and `_analyze_loaded` gives the output shape and the "no buckets" message.
- [/Users/brendanmoore/Github/trainingpeaks-mcp/skills/power-balance-analysis/SKILL.md](/Users/brendanmoore/Github/trainingpeaks-mcp/skills/power-balance-analysis/SKILL.md): the defaults and the reporting conventions (bucket size 25, min datapoints 30).
- [/Users/brendanmoore/Github/trainingpeaks-mcp/tests/test_tools/test_power_balance.py](/Users/brendanmoore/Github/trainingpeaks-mcp/tests/test_tools/test_power_balance.py): the cases to port for parity.

**Verification**
1. Vitest parity: the TypeScript `analyze()` output matches Python golden JSON for power mode and time mode on the same FIT files, including overlap filtering and min-datapoints edge cases.
2. Unit tests for the left/right decode (bit 7 set and unset), the null-split skip, a ride with no left/right data, and bucket boundaries (a power of exactly 250 falls in `[250, 275)`).
3. Playwright: upload two `.fit.gz` files through the file input, check the sidebar summaries, then click the 225-250 row and confirm the view switches to time mode with min and max watts set to 225 and 250 and that the row counts equal the filtered sample counts. Click a time row to go back.
4. Playwright network assertion: no requests are made to any origin other than the page itself during an upload and analysis session, and the CSP blocks any attempted `fetch`.
5. Agent test: a scripted Playwright session using only `setInputFiles`, test ids and `window.bucketsOfPower.getResult()`, with no human interaction.
6. Performance: a 5-hour, 1 Hz ride (about 18k records) and 30 rides load without blocking the main thread.

**Decisions**
- No backend, no analytics, no storage. Files live in memory only. Persistence through IndexedDB is out of scope for v1.
- "Datapoints/sec" is interpreted as seconds per datapoint, default 1, which sets the duration column. It matches `sample_seconds` in the MCP tool.
- Sidebar average power is computed from the record samples, with the session message as the preferred source, not from the last record's `accumulated_power`.
- Only the left/right power balance analysis is in scope. Other FIT analyses are excluded.
- The TrainingPeaks API and MCP integration are excluded.

**Further Considerations**
1. FIT library: the official `@garmin/fitsdk` is the most reliable choice. `fit-file-parser` is lighter but less strict. Recommendation: the official SDK, subject to a bundle-size check.
2. Time-window filter on power-mode drill-down: the Python has no equivalent. Recommendation: add it in the web app only, and document it as a deliberate extension.
3. Time axis for rides with pauses: the Python uses wall-clock timestamps, so paused time creates empty buckets. Recommendation: keep wall-clock behaviour for parity and offer "moving time" as a later option.
