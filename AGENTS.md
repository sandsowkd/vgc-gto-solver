# Working on vgc-gto-solver

Read README.md, PROGRESS.md, docs/algorithms.md and docs/simulator-research.md first.
Repository, Rust package and application are named `vgc-gto-solver`.
The enclosing directory is an unrelated Pokémon LLM repository. Work only here.

## Architecture

- `data`: pinned format JSON and simulator revision. `Cargo.lock` is required.
- `battle`: validated input, team initialization, replay and move-boundary projections.
- `actions`: simulator-authoritative complete joint choices, including targets and Mega flags.
- `policy`: interchangeable continuation baselines, evaluated before either action is submitted.
- `rollout`: independent battle/policy RNG streams and terminal utilities.
- `matrix`: deterministic cell/sample streams, Rayon sweeps, censoring and confidence intervals.
- `solver`: generic rectangular constant-sum games. Keep Pokémon mechanics out of it.
- `search`: root solve, runtime breakdown and interpretation/uncertainty diagnostics.
- `benchmark`: measured throughput and paired side-swapped policy experiments.
- `main`: preserved research CLI; `src/bin/server.rs` starts the local native web service.
- `web` (Rust): Axum validation, bounded cancellable jobs, safe paste fetch and seeded replay.
- `control`: cancellation and actual progress counters; preserve existing uninstrumented APIs.
- `web/src`: React/TypeScript workspace, editors/imports/results and virtualized matrix.
- `data/web-catalog.json`: versioned local UI data; native validation filters all presets.
- UI development is explicitly prioritized by the user. Read docs/web-app.md and docs/ui-research-and-data.md.
- Keep utility perspectives explicit, never fabricate usage/presets/results, and label suggested sets.
- Browser text imports must never silently convert main-series EVs to Champions SP.
- Replay preserves state; do not treat projections as universal lossless checkpoints.

## Correctness conventions

Win/loss/draw utility is 1/0/0.5. Never substitute damage or HP as the optimization objective.
Solving the estimated root matrix with fixed continuation policies does not solve the full game.
Player two minimizes player one's utility; keep EV perspectives explicit.
Keep matrix Nash gap separate from simulation uncertainty and model/policy bias.
Do not impute censored games as draws or missing matrix cells as zero. Return diagnostics without
a point solution when the full point payoff matrix is unavailable.

Full information is intentional. A policy must never read the opponent's pending choice.
Both choices must be computed from the same pre-submission battle state.
Do not independently optimize the two active Pokémon. Preserve engine joint constraints.
Teams may bring up to four, with the first two entries leading. Delegate voluntary switches,
replacement and revival requests to the engine. Hidden-information search and learned evaluation
are future work.

Prefer source inspection and tiny differential experiments to reimplementing simulator mechanics.
Preserve entry ability effects when an override is omitted. Hand-authored projections are advanced
research inputs, not complete Showdown save files; replay is preferred for complex histories.
Keep seeds stable across Rayon scheduling for fixed-work runs. Budget runs may differ.

## Development

Run `cargo fmt --all -- --check`, `cargo clippy --locked --all-targets -- -D warnings`,
`cargo test --locked --release` and relevant reference checks before finishing.
Run `npm ci`, `npm run build`, `npx playwright install chromium`, and `npm run test:e2e`
for frontend/native integration changes. Use `npm run dev` to start both services.
No tests may silently skip missing game data. It is bundled.
Research scripts use a local virtual environment and `scripts/requirements-research.txt`.
Reference clones and build artifacts belong under ignored `.cache/` or outside the repository.
Do not alter the enclosing repository, add a blanket project license, claim unmeasured performance,
or claim tournament strength from the illustrative fixture suite.

Keep PROGRESS.md current with exact blockers and next steps. Preserve raw experiment records.
The user requested **no intermediate commits**: finish implementation and validation before a final commit.

## Deploy app changes

After validating each completed app change, deploy the tested revision to
`https://jeremyhua.ng/vgc` using the configured hosting workflow. Verify that the app
loads at that URL and that `https://jeremyhua.ng/vgc/api/health` returns a healthy
Rust API response. Report the deployed revision and URL. If the deployment workflow,
hosting access, or live verification is unavailable, report the specific blocker.
