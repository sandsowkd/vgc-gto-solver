# Strategy evaluation and iteration

The near-term target is a full-information 4v4 doubles solver with two active Pokémon per side, legal switching, and measurable decision quality. The current CLI solves a root action matrix under fixed follow-up policies. A full-battle equilibrium would require strategies at all reachable decisions and a bound against deviations through the battle. Treat hidden team information as a separate model with its own evaluation.

## Run the evaluator

From the repository root, activate the pinned Rust toolchain and build the release binary.

```sh
cargo build --locked --release --bin vgc-gto-solver
mkdir -p .cache
run_dir=$(mktemp -d "$PWD/.cache/strategy-eval.XXXXXX")
python3 scripts/evaluate_strategy.py --profile quick --output "$run_dir/quick.json"
python3 scripts/evaluate_strategy.py --profile deep --output "$run_dir/deep.json"
```

Quick mode uses two candidate seeds at 8 rollouts per action pair and an independent reference seed at 64 per pair. Deep mode uses three candidate seeds at 32 per pair and 256 per reference pair. The default fixtures form the illustrative no-reserve baseline. Pass `--fixture examples/four-v-four.json` to reproduce the [first 4v4 baseline](../benchmarks/four-v-four-baseline.json). Build a separate locked test split before training or claiming improvements on 4v4 positions.

For an experiment, keep a copy of the previous release binary. Pass `--binary` for the candidate and `--reference-binary` for the frozen evaluator. Run the previous binary through the same protocol and compare at identical fixture hashes, sample counts, policies, thread counts, and seeds. Use `--fixture`, `--samples`, `--reference-samples`, `--threads` and `--timeout` to target more compute at cases where an important conclusion is still uncertain. Use `--budget-ms` on both runs for a matched-time comparison. That budget applies to candidates while the reference uses fixed work. Use a second reference policy on promising changes to see whether the ordering depends on the follow-up policy. The JSON report records binary and fixture hashes, simulator and reference revisions, run settings, actual sample counts, timing and a digest of each fixed-work result.

## Evaluation criteria

| Criterion | Evidence to accept |
| --- | --- |
| Legal play and replay | Existing correctness tests pass. New mechanics match the pinned Showdown trace for legal actions, state after the decision, and deterministic replay. Legacy no-reserve saves and seeded play still work. |
| Honest payoffs | Terminal win, loss and draw count as 1, 0 and 0.5 from the appropriate perspective. Every reported point payoff uses resolved rollouts. Uncovered or censored matrices remain unresolved in the current dense evaluator. |
| Numerical correctness | Check the matrix value and both unilateral best responses independently. On exact small references compare against the known solution. Repeat fixed-work runs across thread counts and check the result digest. |
| Out-of-sample root quality | Score each returned strategy against all actions in a separately sampled, higher-budget reference matrix. Report the payoff interval, each player's best-response action and deviation gain, and the combined gap with its interval. The initial target is an upper gap bound of 0.05 per fixture in the modeled root. If the bound is wider, report a point estimate with uncertainty and leave the target unmet. |
| Effect of a change | Compare incumbent and candidate at equal compute first. For playing-strength changes, run paired, side-swapped seeds against several frozen opponents and report win/draw/loss and paired uncertainty by matchup. Retain promising changes only when gains repeat on held-out matchups or equivalent quality takes less compute. |
| Responsiveness | Under a matched wall-clock budget report coverage, completed work, unresolved positions, and latency. Test cancellation and budget exits on both mobile-sized UI workflows and larger positions when the change touches them. A fast unresolved response cannot substitute for a completed solve. |

For a two-player constant-sum root with player-one payoff matrix \(A\) and strategies \(x,y\), the reference gap is \(\max_i (Ay)_i - \min_j (x^T A)_j\). It sums the two unilateral deviation gains. The reported actions maximize estimated gain on the reference samples. The bounds are simultaneous over all tested actions, candidate seeds and fixtures in the report, so they also cover the selected best responses. With a frozen candidate mix, a sample in cell \(i,j\) has weight \(y_j/n_{ij}\) for a row, \(x_i/n_{ij}\) for a column, or \(x_i y_j/n_{ij}\) for mix utility. The evaluator applies weighted Hoeffding bounds to the independent fixed-count reference samples directly, then bounds the extrema and their difference. It also prints the earlier cellwise bound on the same data to make the two methods comparable.

Use `--reference-seed` to rotate the audit seed for confirmation after choosing a candidate. Both interval methods measure Monte Carlo error under the frozen continuation policy. Follow-up policy bias and whole-battle deviations require separate checks. When introducing sparse search, extend the evaluator with full-reference scoring of omitted actions and explicit coverage before comparing results to the dense baseline.

## Evidence for a whole-battle equilibrium

Use `target/release/vgc-gto-solver exact-reference examples/two-hit-race.json --decisions 2` to check a tiny game with a known winner. The reference enumerates precise engine chance outcomes, then works backward through simultaneous decisions using lower and upper payoff matrices. It uses the existing matrix solver’s certified response bounds. A horizon, action-pair or chance-path cutoff leaves the affected value in `[0, 1]`. The report distinguishes those cutoffs and publishes a game-value interval. One decision in the two-hit fixture can only give `[0, 1]`. Two decisions resolve the battle in favor of the faster Pokémon.

This evaluates optimal game value for small full-information positions. A further step is to measure both players’ whole-battle best responses to a saved candidate policy, allowing a deviation at any reachable decision. Wins against a set of opponents, root gaps and game-value intervals are different measures. A whole-battle equilibrium claim requires a whole-battle deviation bound, including the alternatives that search left unexplored.

## Recurring Codex prompt

In the Codex app, open **Automations → New automation** and paste the prompt below. If the editor offers a thread target, select the existing VGC thread to continue it. Otherwise select the `sandsowkd/vgc-gto-solver` project. Choose the VGC cloud environment if that option is available. A local automation depends on your desktop computer being available.

Set a repeating 40-minute interval if the editor supports it. A 30-minute interval also fits the requested cadence. This cloud session does not expose an automation creation tool. Let each run finish or checkpoint before starting another run on the same branch.

> Continue work on `sandsowkd/vgc-gto-solver` toward a correct, usable full-information 4v4 doubles solver with switching and an evidence-based path to reducing whole-battle exploitability. Read `AGENTS.md`, `docs/4v4-switching-plan.md`, this evaluation rubric, and the last handoff. Inspect the current checkout and any running evaluation before editing.
>
> Pick one change with the biggest measured impact. Prioritize simulator legality, forced replacements and replay until 4v4 passes end to end. Then prioritize reducing decision error and latency under equal compute. Keep regular tests and existing positions working. Run a quick baseline first. Use most of the compute window for targeted deeper runs when those runs could change the decision. Increase independent reference samples or matches, use multiple seeds and held-out teams, and compare the candidate with a frozen incumbent at equal work and equal time. Use supported CPU parallelism and preserve partial results if interrupted. Train only after there is a stable benchmark, and keep test teams and replay lineages out of training.
>
> For each run save the tested revision, tested fixtures and seeds, actual compute, evidence paths, correctness checks, candidate versus incumbent metrics, unresolved cases, and the next experiment in `PROGRESS.md` or its linked benchmark report. Send a short evaluation update with the observed result and its uncertainty. If a run is already active, check its progress before launching another. Apply the repository deployment rule after validated app changes and report any live hosting blocker. Describe full-game equilibrium only if the full modeled game and its deviation bound have been validated. Stop and report the blocker if a necessary external permission or resource is missing.
