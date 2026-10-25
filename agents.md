# Agent guide

## Upload and inspect

1. Navigate to the app and pass one or more `.fit` / `.fit.gz` files to `#fit-upload` using a DOM-based file-input API (`setInputFiles` in Playwright).
2. Wait for `[role="status"]` to announce the load result.
3. Read the current analysis from `JSON.parse(document.querySelector('#bop-state').textContent)` or `window.bucketsOfPower.getResult()`.
4. Set or share analysis parameters through `window.bucketsOfPower.setOptions({...})` or the URL hash: `group_by`, `bucket_size`, `time_bucket_minutes`, `min_watts`, `max_watts`, `min_datapoints`, `sample_seconds`, `min_minute`, `max_minute`.

## Browser API

- `loadFiles(files: File[])`: parse selected files in a browser worker.
- `setOptions(opts)`: update analysis options.
- `selectWorkouts(ids: string[])`: select exactly these locally loaded workout IDs.
- `drillDown(axis: 'power' | 'time', lo: number, hi: number)`: click-equivalent drill-down.
- `getResult()`: return the current MCP-shaped JSON result.
- `getWorkouts()`: return current local workout state and IDs.

Controls expose stable test IDs: `fit-upload`, `group-by-power`, `group-by-time`, `min-watts`, `max-watts`, `bucket-size`, `min-datapoints`, `sample-seconds`, `workout-checkbox`, and `bucket-row`. Table rows have `data-bucket-lo`, `data-bucket-hi`, and `data-axis`. File selection is local and cannot be encoded in a shareable URL.

No content is transmitted to any server. The CSP blocks connections with `connect-src 'none'`.