# BucketsOfPower

BucketsOfPower is a static, client-only FIT power-balance analyzer. FIT files are parsed and analyzed in your browser; they are not uploaded, persisted, or sent to a server.

## Development

Install dependencies with `npm install`, then use `npm run dev` to start the Vite development server. Run `npm test` for unit tests, `npm run build` for a production build, and `npm run test:e2e` for Playwright end-to-end tests (install browsers with `npx playwright install` first).

## Privacy guarantee

The application has no backend or analytics and processes selected files in memory only. A Content Security Policy sets `connect-src 'none'`, preventing browser network connections initiated by the app. The only file access is the user's explicit local file selection. Files are discarded when removed or when the page is closed.

## Browser API

Use the persistent file input `#fit-upload` to load `.fit` or `.fit.gz` files. Current output is available in `#bop-state` as JSON, and browser automation can use `window.bucketsOfPower` (`loadFiles`, `setOptions`, `selectWorkouts`, `drillDown`, `getResult`, `getWorkouts`). Analysis controls are reflected in the URL hash; local workout selection is intentionally not shared.