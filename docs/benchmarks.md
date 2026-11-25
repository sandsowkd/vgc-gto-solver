# Measured experiments

All results below were executed on 2026-11-24 on an Apple M5, 10 logical CPUs, 32 GiB RAM,
macOS 26.6.2 arm64, Rust 1.100.0, optimized release build. Exact JSON records live in
`benchmarks/results.json`, `lp-validation.json`, `showdown-validation.json`,
`simulator-support.json`, `memory.json` and `endgame-solve.json`. No advertised upstream
throughput is reproduced as a measurement here.

## Methodology and limits

The two full doubles positions are hand-authored legal sets in the pinned Reg M-C data:
Garchomp/Rotom-Wash versus Mega Charizard Y/Clefable, and Tyranitar/Excadrill versus
Mega Gardevoir/Incineroar. They exercise targeting, friendly fire, spread attacks, weather,
Mega Evolution, support and priority. They have no reserves and are much shorter than standard
four-mon battles. They are illustrative archetypes, **not** a random tournament-position sample.
The second matchup and its derived endgames are held out from initial policy construction;
no heuristic tuning was performed against their scores.

Microbenchmarks load the Dex/root first, time 100,000 clones and pairs of side enumerations,
then 2,000 complete games with one thread per policy/position. Matrix iteration throughput
uses 100,000 RM+ iterations on a fixed 2×3 matrix. End-to-end timing includes initialization,
action descriptions, sampling and matrix solving, but excludes process startup/input parsing
and output serialization. Budget records also include subprocess wall time. Thread/budget
settings are single timing trials on an active desktop, not controlled hardware experiments;
reference-validation work also ran during part of the sweep. The three fixed-sample seeds
provide a small repeat/stability check. Treat small timing differences cautiously.

The principal root has **60×96 = 5,760 legal joint-action pairs**, including legal ally-target
attacks and Mega/non-Mega variants. All are retained. Fixed-work seeds are 1 for scaling and
11, 29, 47 for stability. Sampling uses independent cell/sample streams; every pair gets a
sample before further refinement. Every started rollout completes, subject to its 256-turn/
1,024-decision cap. No truncations occurred in these throughput/solve/match experiments.

## Throughput

Enumeration time covers both sides together. Battles/sec includes cloning and the selected
continuation policies, with logging disabled.

| Position | Policy | Battles/s | Turns/s | Clone µs | Joint enumeration µs |
| --- | --- | ---: | ---: | ---: | ---: |
| doubles | random | 36,949 | 154,835 | 0.475 | 3.738 |
| doubles | greedy | 13,960 | 14,616 | 0.375 | 3.825 |
| doubles | tactical | 13,682 | 14,359 | 0.406 | 4.087 |
| held-out | random | 35,945 | 128,575 | 0.400 | 4.800 |
| held-out | greedy | 13,473 | 15,285 | 0.422 | 4.641 |
| held-out | tactical | 12,886 | 14,613 | 0.440 | 4.680 |

The tiny generic game ran at 35.5–37.8 million iterations/s. This does not describe
iteration cost on the 60×96 root, which is materially larger.

## CPU scaling

Fixed four samples per pair (23,040 full-game rollouts), identical seeds and matrix results.

| Threads | Matrix estimation ms | Regret solving ms | Total ms |
| ---: | ---: | ---: | ---: |
| 1 | 1140.4 | 82.1 | 1231.9 |
| 2 | 869.9 | 81.3 | 960.2 |
| 4 | 551.0 | 72.4 | 633.1 |
| 10 | 466.8 | 81.6 | 557.8 |

One to ten threads improved matrix estimation by 2.44×. Scaling is limited; adding threads
is not a substitute for profiling allocation, policy cost and task granularity.

## Soft computation budgets

Requested 1,000,000 samples/cell so the budget is the active sampling limit; ten threads.
The sampler reserves 10% for solving. It can finish early if convergence is reached, or
overshoot at a started-rollout/100-solver-iteration boundary. Values below are estimated
fixed-greedy-continuation utilities, **not** full-game equilibrium win probabilities.

| Requested ms | Reported total ms | Samples/cell range | Full coverage? | Utility | Matrix gap | Statistical gap upper bound |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 100 | 90.4 | 0–1 | no | — | — | — |
| 500 | 500.8 | 3–4 | yes | 0.9110 | 0.001332 | 1.000 |
| 1000 | 951.8 | 7–8 | yes | 0.9152 | 0.000995 | 1.000 |
| 2000 | 1831.0 | 16–17 | yes | 0.9095 | 0.000962 | 0.840 |
| 5000 | 4524.0 | 40–41 | yes | 0.9157 | 0.000975 | 0.586 |
| 10000 | 9024.8 | 81–82 | yes | 0.9194 | 0.000993 | 0.448 |

The 100 ms budget did **not** cover every action pair, so no strategy was returned.
Even 10 seconds left a substantial statistical gap bound. A gap near 0.001 on the sampled
matrix alone is weak evidence of a well-estimated root game.

## Fixed-work seed stability

32 samples per pair = 184,320 full-game rollouts per run, ten threads.

| Seed | Sampling ms | Solving ms | Total ms | Utility | Matrix gap | Simultaneous 95% utility interval |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 11 | 3662.3 | 26.5 | 3698.5 | 0.9162 | 0.000925 | [0.357, 1.000] |
| 29 | 3580.9 | 30.7 | 3622.1 | 0.9286 | 0.000969 | [0.370, 1.000] |
| 47 | 3664.0 | 21.4 | 3694.9 | 0.9121 | 0.000971 | [0.353, 1.000] |

Pairwise L1 strategy distances (maximum possible 2):

| Seeds | Player 1 | Player 2 |
| --- | ---: | ---: |
| 11 / 29 | 1.538 | 1.396 |
| 11 / 47 | 1.600 | 1.212 |
| 29 / 47 | 1.546 | 1.476 |

Mixtures vary substantially despite converged empirical gaps. Some variation can come from
near-equivalent actions/multiple equilibria as well as sampling noise; L1 distance alone is
not a playing-strength measure. The wide simultaneous intervals independently show that the
current sample counts do not certify root-game quality. Improving variance and allocation,
with stronger held-out evaluation, is the next priority.

## Playing-strength experiments

Each pair uses both policy/team assignments and a shared seed. Pair seeds derive from
20261124. Baseline comparisons use 200 independent pairs (400 games) per matchup. Solver
comparisons re-solve at **every decision**, using greedy continuations, one thread, max 10,000
RM+ iterations, matrix-gap tolerance 0.005. Three 1v1 boards use 50 pairs and 16 samples/cell;
two reduced 2v2 boards use 25 pairs and 8 samples/cell. The latter retain both mons, with one
attack plus Protect and HP=80. Exact evaluated boards are stored in the JSON record.

The 95% Hoeffding intervals treat a side-swapped pair average as one bounded observation.
They are per-comparison intervals, with no adjustment across the whole exploratory suite.
No draws or truncations occurred, so empirical utility equals win rate for these matches.

| Position | A | B | Games | A wins | A win rate | Paired 95% interval |
| --- | --- | --- | ---: | ---: | ---: | --- |
| doubles | greedy | random | 400 | 380 | 95.0% | [85.4%, 100.0%] |
| doubles | tactical | random | 400 | 380 | 95.0% | [85.4%, 100.0%] |
| doubles | tactical | greedy | 400 | 200 | 50.0% | [40.4%, 59.6%] |
| held-out (held out) | greedy | random | 400 | 387 | 96.8% | [87.1%, 100.0%] |
| held-out (held out) | tactical | random | 400 | 387 | 96.8% | [87.1%, 100.0%] |
| held-out (held out) | tactical | greedy | 400 | 200 | 50.0% | [40.4%, 59.6%] |
| endgame-0 | solver | random | 100 | 53 | 53.0% | [33.8%, 72.2%] |
| endgame-0 | solver | greedy | 100 | 50 | 50.0% | [30.8%, 69.2%] |
| endgame-0 | solver | tactical | 100 | 50 | 50.0% | [30.8%, 69.2%] |
| endgame-1 | solver | random | 100 | 50 | 50.0% | [30.8%, 69.2%] |
| endgame-1 | solver | greedy | 100 | 50 | 50.0% | [30.8%, 69.2%] |
| endgame-1 | solver | tactical | 100 | 50 | 50.0% | [30.8%, 69.2%] |
| endgame-2 (held out) | solver | random | 100 | 56 | 56.0% | [36.8%, 75.2%] |
| endgame-2 (held out) | solver | greedy | 100 | 50 | 50.0% | [30.8%, 69.2%] |
| endgame-2 (held out) | solver | tactical | 100 | 50 | 50.0% | [30.8%, 69.2%] |
| reduced-doubles-0 | solver | random | 50 | 41 | 82.0% | [54.8%, 100.0%] |
| reduced-doubles-0 | solver | greedy | 50 | 23 | 46.0% | [18.8%, 73.2%] |
| reduced-doubles-0 | solver | tactical | 50 | 23 | 46.0% | [18.8%, 73.2%] |
| reduced-doubles-1 (held out) | solver | random | 50 | 44 | 88.0% | [60.8%, 100.0%] |
| reduced-doubles-1 (held out) | solver | greedy | 50 | 29 | 58.0% | [30.8%, 85.2%] |
| reduced-doubles-1 (held out) | solver | tactical | 50 | 29 | 58.0% | [30.8%, 85.2%] |

Greedy easily beats random in these short authored matchups. Tactical does not improve on
greedy here. The solver beats random on the reduced doubles boards but its intervals versus
greedy/tactical overlap 50% widely. These experiments **do not establish an advantage over
greedy, let alone tournament strength**. Several 1v1 boards are strategically trivial; the
next corpus should emphasize genuine defensive/mixed choices and avoid overwhelming team
advantages. A larger frozen held-out suite is more valuable than tuning these examples.

## Peak memory

A separate macOS `/usr/bin/time -l` run of the 32-samples/cell, ten-thread doubles solve
reported **28.3 MiB peak resident memory**. The solve's own runtime was
3.786 seconds; process timing also includes JSON output serialization. This
is one process/fixture measurement, not a general bound for larger rosters or future searches.

## Independent correctness checks

- 24 Rust mathematical/integration tests, including RPS, matching pennies, saddle/dominated/
  rectangular/nonuniform games, complement symmetry, malformed input, targeting, Mega/Protect,
  fainted slots, Struggle/two-turn forced actions, a tiny exact-chance forced win, independent
  clones, projection round-trip, policy isolation, entry-effect preservation and truncation.
- 64 random rectangular games, each checked with both RM and RM+ against independent
  SciPy 1.18.1 / HiGHS (128 comparisons): maximum value error **0.0009933804**, maximum matrix
  gap **0.0039507049**. Every LP value lies inside the computed best-response interval.
- 15 seeded complete games against pinned Showdown, comparing **183 full states** after each
  individual input, including the RNG state. All matched. This is not exhaustive parity.
- Support audit from the bundled format: 510 moves, 166 items, 221/224 supported abilities.
  Unsupported requested entities are rejected.

## Reproduce

Follow README.md for toolchain/reference setup. `scripts/run_benchmarks.py` regenerates the
performance/playing-strength JSON; `scripts/validate_lp.py` and `validate_showdown.py` regenerate
reference records. `cargo run --release --example audit_simulator` emits coverage. Use
`/usr/bin/time -l` on macOS or `/usr/bin/time -v` on Linux for a separate peak-memory trial.
No performance threshold is enforced in CI because hosted machines differ. Mathematical,
format/lint and Showdown differential checks are enforced instead.
