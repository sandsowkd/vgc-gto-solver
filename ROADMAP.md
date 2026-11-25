# vgc-gto-solver roadmap

## Completed initial foundation

- Pinned Ninjask/Showdown integration and bundled regulation export.
- No-reserve 2v2, 2v1 and 1v1 positions; complete legal joint actions and Mega choices.
- JSON/packed-team inputs, controlled state overrides, replay and boundary projections.
- Random, greedy and initial tactical continuation policies; terminal utility sampling.
- Reproducible parallel all-pair matrix estimation with uncertainty/censoring diagnostics.
- Independent RM/RM+ matrix library, analytical tests, SciPy/HiGHS and Showdown checks.
- CLI, measured experiments and continuous integration.

## Completed interactive application

- React/TypeScript/Vite desktop and responsive mobile workspace; native Axum serving/API.
- Four-slot editor with native legality/stats, source-attributed competitive presets and real usage.
- Showdown/SP/PokePaste imports, six-mon selection, text/JSON export and local named positions.
- Actual progress, cancellation, stale-result invalidation, resource bounds and structured errors.
- Joint strategies, utility/loss, marginals, virtualized payoff matrix and Player 2 node locking.
- Engine turn progression, seeded replay history, undo/restart and re-solving.
- Browser integration tests, actual screenshots, dependency/data/license investigation.

## Next application improvements

1. Safe current-boundary edits that retain untouched engine state, with explicit semantics for
   volatile/ability/item state; reverse node locking and named per-player team libraries.
2. Improve low-sample statistical guidance and benchmark alternative continuation policies.
3. Add authenticated per-user jobs/rate limits before public multi-user deployment; package a
   Linux/container release with notices and optional local sprite caching.
4. Add pinned new-regulation data and set snapshots with audited provenance; select an owner-approved
   original-source license before encouraging distribution. A WASM worker is an exploratory option.

## Next research: strategy quality and statistical efficiency

1. **Reduce payoff variance and establish reliable strategy evaluation.** Seed instability is
   large at 32 samples/cell despite a small matrix Nash gap. Compare variance-reduction schemes
   and confidence-driven allocation while preserving coverage of every legal root action.
   Build a larger, frozen held-out position corpus with nontrivial defensive/mixed decisions.
2. Replace ad hoc tactical bonuses with measured improvements to survival, Protect/redirection,
   KO races, speed control and Mega-form damage estimates. Evaluate against multiple continuation
   opponents rather than optimizing to one policy's weaknesses.
3. Add tiny exact stochastic endgame solutions as independent search references, retaining
   hard outcome-enumeration path limits and comparing Monte Carlo utility estimates to them.
4. Extend differential fixtures for recharge/two-turn/called moves, Transform, Illusion, revival,
   residual-order interactions, status and live complex projection histories. Keep known failures
   as minimal reproducible regressions and report upstream bugs.
5. Profile large all-pair solves before changing allocation/layout. Current scaling from one
   to ten threads is limited; evaluate scheduling/batching, caching and memory use separately.
6. Clarify owner-selected project licensing, competitive set provenance and a stable input/output
   schema; expand native import/editor validation as supported mechanics grow.

## Later research

Selective simultaneous depth-2 search, comparisons to simultaneous-move MCTS, search-guided
self-play, learned terminal-value prediction and native inference. Require improvements on
held-out playing-strength and calibration tests before claiming a stronger solver.

Standard four-mon bring-four play, reserves/voluntary switching and imperfect-information
beliefs/information-set consistency are separate milestones. Interactive web development now
overrides the earlier frontend deferral. Deep game-tree exploration and WebAssembly remain later work.
