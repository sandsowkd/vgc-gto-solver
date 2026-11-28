# Interactive application

## Run and deploy

Use Rust 1.100.0 and Node 24 LTS (Node 23.6 was also used locally). From the repository root:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The command starts Vite with an `/api` proxy and the **release-mode** native Axum backend on 127.0.0.1:8787. The first Rust build can take several minutes. Ctrl-C stops both children. The CLI remains `cargo run --release -- solve examples/doubles.json`.

Production, on one machine:

```sh
npm ci
npm run build
cargo build --locked --release --bin server
./target/release/server
```

Open http://127.0.0.1:8787. Ship `web/dist/`, the native binary and third-party notices together; run with the repository/package root as working directory. Axum serves the Vite build and its API from the same origin. No Node process, database or network data API is needed in production. Fonts and sprite artwork currently load externally with system-font/text fallbacks.

`VGC_BIND` changes the listen address (default loopback). `VGC_THREADS` caps native solve threads (1 through min(8, logical CPUs)); default requests use at most four. `VGC_APP_ORIGIN=https://solver.example` permits a separately hosted frontend. Public deployment needs a TLS reverse proxy, authentication/rate limiting and per-user job ownership before sharing a single service with untrusted users. The current job IDs and one-job admission limit suit a personal local workspace, not multi-tenant hosting. Do not expose the local service directly to the Internet.

The personal site's Vercel project builds the frontend with `npm run build -- --base=/vgc/`
and serves it at [jeremyhua.ng/vgc](https://jeremyhua.ng/vgc). The site rewrites
`/vgc/api/*` to the Rust function in `api/vgc.rs`. This function runs the same
Axum API and native solver. A streaming solve stays in one invocation for its entire
lifetime. It emits progress and a terminal result or error as server-sent events.
Closing the stream requests cooperative cancellation. An interrupted connection can
be retried from the same board and configuration.


## Integration and resource limits

The React/TypeScript app calls the Rust library through Axum; it never starts a CLI subprocess per solve and contains no second damage engine. API routes:

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Native readiness and pinned format |
| `GET /api/catalog` | Locally bundled data, presets, usage, supported selections, limits |
| `POST /api/validate` | One Pokémon set; returns native Champions stats |
| `POST /api/inspect` | Board plus history → engine state, complete legal joint actions, events |
| `POST /api/solve-stream` | `{board, config}` → progress events and final result or error |
| `POST /api/solve` | Local job ID. On Vercel this also serves the streaming API. |
| `GET /api/jobs/:id` | Phase, coverage, actual samples, numerical convergence, result/error |
| `POST /api/jobs/:id/cancel` | Cooperative cancellation |
| `POST /api/advance` | `{board, step}` → replayed native next state and event log |
| `POST /api/import` | Validated PokePaste URL → raw team text |

A board is `{position: <explicit-teams Position>, history: [{choices: [p1, p2], seed}]}`. History replays from its original setup with the native RNG reset to each recorded decision seed. This preserves hidden engine counters/volatiles without treating the state projection as a lossless save. Undo drops a decision and restart clears history. Battle end is inspectable. A forced replacement can pause within a turn, and a waiting side sends an empty choice. The solver models that side with one no-op action. The UI uses engine choice strings and labels the incoming reserve, move targets and Mega choices.

One solve per process at a time. Excess requests to a busy process receive 429. CPU work runs in `spawn_blocking`, with Rayon threads bounded by the service cap. Web solves require a 1–60000 ms soft budget, 1–4096 samples/pair, 1–512 rollout turns, at most 500000 matrix iterations, and at most 65536 root action pairs. Request bodies are limited to 1 MiB and history to 80 decisions. The local polling API retains at most 16 jobs and prunes completed jobs after 15 minutes on submission. Cancellation is checked within rollout decisions and matrix iterations. A started rollout finishes after a budget deadline to avoid length-biased censoring, but explicit cancellation interrupts it and discards the job result. Board edits invalidate results and abort the active solve stream.

PokePaste imports accept only HTTPS `pokepast.es` and a 16-hex-digit path, with no credentials, explicit nondefault port, query or fragment. The service constructs the upstream URL itself, follows no redirects, uses an eight-second timeout, and stops downloads above 512 KiB. It cannot fetch arbitrary supplied hosts/paths. Application validation errors use `{error: {message}}`; malformed JSON/schema failures additionally use Axum's 4xx rejection text, which the client displays.

## Interaction and interpretation

The board starts with editable published sets. Click a Pokémon to search supported species, select a source-attributed preset, then edit its legal set and battle state. Add up to two reserves per side and use **Lead A** or **Lead B** to change starting leads. A missing slot supports 1v1/2v1. Set up living leads or replay into a knockout when a living reserve can replace them. Field edits preserve other visible field properties and explicitly override entry effects. Leaving them untouched preserves native entry abilities.

Showdown imports use MIT `@pkmn/sets`. Explicit `SPs:` and `Stat Points:` mean Champions points. `EVs:` requires explicit confirmation that the numbers already represent SP; values above 32/stat or 66 total are rejected even when confirmed. No conversion is performed. Custom IVs, Tera/Dynamax fields and non-level-50 sets are rejected. Mega species labels normalize to the base species only with a matching stone and
a valid pre-Mega ability; imports with a post-Mega-only ability must explicitly choose the base
ability in the editable paste text. Import up to six, then choose up to four to bring. The first two selected lead. Export uses `SPs:`. Separate sides have separate imports. JSON exports retain seeded history. Text exports retain starting sets.

Strategy rows always describe **correlated joint actions**. Player 2 EVs are converted to Player 2 utility, and action loss compares against that side's best response to the solved opponent mix. Optional individual marginals are explicitly labelled and omit partner correlation. Win/draw/loss bars weight each cell's observed proportions by the solved strategy pair; they are estimates under the continuation policies, not empirical head-to-head tournament results. Utility is win + half draw. It is not strictly win probability.

The matrix virtualizes visible cells, supports equilibrium-support filtering/full inspection, probability sorting, hover/select details and conservative confidence intervals. The node-lock view normalizes user-entered Player 2 weights and computes Player 1's pure best response against that fixed distribution using the real estimated matrix. It does not relabel the best response an equilibrium. Statistical error remains present.

Browser storage keeps the active board and named saves. JSON download/upload and position links are available. Links contain the entire starting position and seeded history in the fragment (no server save); long histories should use JSON. Saves do not persist solve results. This is a full-information research tool.

## Current limits and WASM investigation

- Pinned Regulation M-C, full information, and up to four brought Pokémon per side. Bring-four choices and leads are selected manually.
- Root-matrix equilibrium under fixed continuation policies, not exact full-game GTO. Uncertainty can remain very wide at useful interactive budgets. Missing/censored cells return diagnostics, never fabricated recommendations.
- Setup editing is separate from replay exploration. Return to setup before editing teams/field. Arbitrary current-state volatiles, consumed-item ability flags and already-Mega snapshots are not exposed as static editor controls; native turn progression preserves them. No universal projection checkpoint is promised.
- Node locking currently fixes Player 2 and computes Player 1 best response; reverse locking is a later UI extension.
- Native engine legality is authoritative for in-battle moves, voluntary switching, pivot moves and forced changes. Web board validation also checks duplicate species and held items within a side.
- The native simulator's core is a plausible WASM target, but this application has no working WASM build. Axum/reqwest remain server-side, native Rayon threading must be replaced or configured with wasm-bindgen-rayon/SharedArrayBuffer and cross-origin isolation, clocks/cancellation and payload size need profiling. Native deployment preserves current performance and avoids blocking this usable release on that work.

## Verification

`npm run build`, `npm run test:unit`, and `npm run test:e2e` (first `npx playwright install chromium`) check imports and actual Chromium interactions. Tests start both services unless compatible local instances are running. Rust checks remain `cargo fmt --all -- --check`, `cargo clippy --locked --all-targets -- -D warnings`, and `cargo test --locked --release`. See PROGRESS.md for the final executed results and `docs/screenshots/` for actual browser captures.
