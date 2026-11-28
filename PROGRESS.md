# vgc-gto-solver web application progress

2026-11-24: User explicitly prioritized a real interactive application and renamed the project
and GitHub repository to `vgc-gto-solver`. Repository/local directory/origin/package/branding
renamed. The enclosing repository is unrelated and untouched. **No intermediate commits.**

## Implemented

- React 19 / TypeScript / Vite workspace, compact four-mon board, sprites/type/item artwork,
  searchable keyboard selectors, sourced competitive sets, Champions SP and native stat validation.
- 293 selectable base species/forms; **565 natively valid presets (415 published, 150 suggested)**.
  Published entries without recorded SP are excluded. Independent October 2026 Smogon matching-
  regulation usage snapshot, grouped across base/battle forms, with source/cutoff/checksum.
- Editable item/ability/nature/learnset/moves, HP/status/stages/PP/active turns, field and screens;
  empty/fainted slots; actual Mega/items/boosts/PP reflected after native turn simulation.
- MIT @pkmn/sets Showdown/SP import/export, six-mon selection, independent side imports and
  allowlisted, no-redirect, bounded PokePaste fetch. EVs are never silently converted.
- Native Axum API calling the Rust library with bounded spawn_blocking/Rayon work, progress,
  cancellation, request/resource limits, real results, stale-result invalidation and errors.
- Joint mixed strategies, EV/loss/targets, marginals, weighted observed W/L/D, uncertainty,
  virtualized selectable payoff heatmap and Player 1 best response to a custom Player 2 lock.
- Real seeded engine replay, events, undo/restart/re-solve; local named saves, JSON and share links.
- One-command development and single-origin production serving, deployment/WASM investigation,
  data/license/design documentation and retained dependency notices.

## Completed verification

- Production TypeScript/Vite build passed with strict unused-variable checks.
- `cargo fmt --all -- --check` and strict all-target Clippy passed.
- **28 Rust tests passed**, including all 565 presets, native seeded replay/Mega, cancellation,
  safe paste URLs and the original battle/matrix suite.
- **6 Playwright tests passed** (4 parser tests and 2 substantial Chromium workflows). Actual
  interactions cover four species, presets/items/abilities/moves/SP/stages/PP, six-mon import,
  field configuration, native solve, both strategies/marginals, matrix, node lock, edits/re-solve,
  real turn progression, current field-duration updates, undo, cancellation, short budgets,
  malformed inputs, persistence and a 390px phone layout.
- **128 SciPy/HiGHS comparisons passed** (64 independent games × 2 algorithms), maximum value
  error 0.00099338. **6 seeded Showdown games / 92 state comparisons passed**. Raw records are
  retained in `benchmarks/ui-release/`. CLI matching-pennies smoke check passed (value .5, gap 0).
- `npm audit --audit-level=moderate`: **0 vulnerabilities**. Live allowlisted PokePaste fetch
  returned a real team successfully; arbitrary-host requests and cross-origin writes were rejected.
- Actual desktop strategy/matrix and mobile/editor screenshots are in `docs/screenshots/` and
  were visually inspected. A production-served workspace capture also exercises the built app.
- A default-position native smoke solve covered all 13824 pairs, 132032 samples, zero censored
  rollouts, about 4.54 s on this machine. This is a smoke check, not a new playing-strength claim.

## Deliberate limits

Root estimated game under fixed continuation policies, not full-game GTO; intervals may be
wide. Pinned M-C, no reserves/voluntary switches/hidden sets. Editing replayed states requires
returning to setup. Arbitrary volatiles, initial Mega and consumed-item flags are not editor
inputs; engine replay preserves those states. Node locking currently fixes Player 2 only.
Artwork/fonts use external sources with fallbacks. Local personal-use API needs authentication,
rate limits and job ownership before public multi-user exposure. No working WASM build yet.

Implementation and validation are complete. No intermediate commits were made. Next work is
statistical efficiency / held-out strategy quality, safe edits to current replay boundaries,
and authenticated deployment if public multi-user access is desired. See docs/web-app.md and
docs/ui-research-and-data.md for architecture, sources and exact caveats.

## Deployment path

A production build with `--base=/vgc/` now uses that base for browser navigation and API
requests. A local reverse-proxy smoke test verified the `/vgc` redirect, asset serving,
API health, and a native solve in Chromium at a 390 px viewport. The root build, 28 Rust
tests, and 6 Playwright tests also passed. The live route remains pending access to the
site's routing configuration and a host for the Rust service.

## 4v4 evaluation baseline

The [switching plan](docs/4v4-switching-plan.md) and [strategy evaluator and iteration prompt](docs/strategy-evaluation.md)
define the next milestone and the evidence required to promote a search change. The first deep run
completed 4,736,512 rollouts across three existing no-reserve positions. In `held-out.json` the
independent reference gap ranged from 0.054 to 0.073 across three candidate seeds. The conservative
upper bounds ranged from 0.381 to 0.407, so this did not meet the 0.05 target. The evaluator also
verified matching fixed-work digests at one and four threads and marked a 1 ms incomplete solve
unresolved. Raw JSON and the paired policy comparison are retained in `.cache/strategy-eval.*`
and `.cache/strategy-match.*` in the development environment.

## Playable 4v4 and its first benchmark

The app now accepts up to four brought Pokémon per side. You can edit the reserves, change
leads, choose simultaneous moves and switches, and replay or undo replacement decisions. A
waiting player has one no-op action in the solve. The editor still supports no-reserve endgames.

- All 30 Rust tests and both builds passed. The phone-width test covers adding a reserve,
  editing leads, rejecting incompatible partner actions, switching, replacing a knockout,
  undoing, reloading and solving. A native test covers a pivot with actions still in the queue.
- Showdown agreed on 146 states over eight seeded games, including 54 states in the two 4v4 games.
- The [4v4 baseline](benchmarks/four-v-four-baseline.json) completed 736,960 rollouts across
  9,212 possible root action pairs. On fresh reference samples the two candidate gaps were 0.118
  and 0.172. Neither met the 0.05 upper-bound target. This is one illustrative position. The
  paired match gave the tactical baseline 0.508 utility against greedy with a 95% interval of
  0.411–0.604, so it does not establish a stronger follow-up policy.

Next, add a frozen corpus of switching and replacement positions and compare a switch-aware
continuation policy to the current baselines at equal compute. The session has no persistent
40-minute scheduling tool. Live deployment remains blocked by missing hosting access and an
egress denial to `jeremyhua.ng`.
