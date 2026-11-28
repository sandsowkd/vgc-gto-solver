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

Quick mode uses two candidate seeds at 8 rollouts per action pair and an independent reference seed at 64 per pair. Deep mode uses three candidate seeds at 32 per pair and 256 per reference pair. Both use the existing endgame, doubles, and held-out matchup fixtures. These fixtures are an illustrative no-reserve baseline. Keep an additional locked 4v4 test split as soon as the simulator integration supports it.

For an experiment, keep a copy of the previous release binary. Pass `--binary` for the candidate and `--reference-binary` for the frozen evaluator. Run the previous binary through the same protocol and compare at identical fixture hashes, sample counts, policies, thread counts, and seeds. Use `--fixture`, `--samples`, `--reference-samples`, `--threads` and `--timeout` to target more compute at cases where an important conclusion is still uncertain. Use `--budget-ms` on both runs for a matched-time comparison. That budget applies to candidates while the reference uses fixed work. Use a second reference policy on promising changes to see whether the ordering depends on the follow-up policy. The JSON report records binary and fixture hashes, simulator and reference revisions, run settings, actual sample counts, timing and a digest of each fixed-work result.

## Evaluation criteria

| Criterion | Evidence to accept |
| --- | --- |
| Legal play and replay | Existing correctness tests pass. New mechanics match the pinned Showdown trace for legal actions, state after the decision, and deterministic replay. Legacy no-reserve saves and seeded play still work. |
| Honest payoffs | Terminal win, loss and draw count as 1, 0 and 0.5 from the appropriate perspective. Every reported point payoff uses resolved rollouts. Uncovered or censored matrices remain unresolved in the current dense evaluator. |
| Numerical correctness | Check the matrix value and both unilateral best responses independently. On exact small references compare against the known solution. Repeat fixed-work runs across thread counts and check the result digest. |
| Out-of-sample root quality | Score each returned strategy against all actions in a separately sampled, higher-budget reference matrix. Report the payoff interval, both deviation gains, and the reference gap with its interval. The initial target is an upper gap bound of 0.05 per fixture in the modeled root. If the bound is wider, report a point estimate with uncertainty and leave the target unmet. |
| Effect of a change | Compare incumbent and candidate at equal compute first. For playing-strength changes, run paired, side-swapped seeds against several frozen opponents and report win/draw/loss and paired uncertainty by matchup. Retain promising changes only when gains repeat on held-out matchups or equivalent quality takes less compute. |
| Responsiveness | Under a matched wall-clock budget report coverage, completed work, unresolved positions, and latency. Test cancellation and budget exits on both mobile-sized UI workflows and larger positions when the change touches them. A fast unresolved response cannot substitute for a completed solve. |

For a two-player constant-sum root with player-one payoff matrix \(A\) and strategies \(x,y\), the reference gap is \(\max_i (Ay)_i - \min_j (x^T A)_j\). The evaluator computes conservative bounds from simultaneous cell intervals and keeps the candidate’s own matrix gap separate. These intervals apply to each frozen reference matrix. Evaluate claims across fixtures and follow-up policies separately. When introducing sparse search, extend the evaluator with full-reference scoring of omitted actions and explicit coverage before comparing results to the dense baseline.

## Evidence for a whole-battle equilibrium

Start with tiny full-information games where chance outcomes and all legal decision branches can be enumerated. At simultaneous decisions, solve a joint-action matrix using the values of successor states. At chance nodes, weight successors by their engine probabilities. At one-sided replacement decisions, let the acting side choose while the other waits. Measure both players’ whole-battle best responses to the resulting policies, allowing a deviation at any reachable decision. Then compare approximate search to these references as the state space grows. If a horizon or compute budget leaves successors unresolved, include their possible utility range in the bound. Wins against a set of opponents and small root gaps are useful intermediate measures. A whole-battle equilibrium claim requires a deviation bound for the modeled battle, including the alternatives that search left unexplored.

## Recurring Codex prompt

Use this prompt at a 40-minute cadence where a persistent Codex scheduler is available. Let each run finish or checkpoint before starting another run on the same branch.

> Continue work on `sandsowkd/vgc-gto-solver` toward a correct, usable full-information 4v4 doubles solver with switching and an evidence-based path to reducing whole-battle exploitability. Read `AGENTS.md`, `docs/4v4-switching-plan.md`, this evaluation rubric, and the last handoff. Inspect the current checkout and any running evaluation before editing.
>
> Pick one change with the biggest measured impact. Prioritize simulator legality, forced replacements and replay until 4v4 passes end to end. Then prioritize reducing decision error and latency under equal compute. Keep regular tests and existing positions working. Run a quick baseline first. Use most of the compute window for targeted deeper runs when those runs could change the decision. Increase independent reference samples or matches, use multiple seeds and held-out teams, and compare the candidate with a frozen incumbent at equal work and equal time. Use supported CPU parallelism and preserve partial results if interrupted. Train only after there is a stable benchmark, and keep test teams and replay lineages out of training.
>
> For each run save the tested revision, tested fixtures and seeds, actual compute, evidence paths, correctness checks, candidate versus incumbent metrics, unresolved cases, and the next experiment in `PROGRESS.md` or its linked benchmark report. Send a short evaluation update with the observed result and its uncertainty. If a run is already active, check its progress before launching another. Apply the repository deployment rule after validated app changes and report any live hosting blocker. Describe full-game equilibrium only if the full modeled game and its deviation bound have been validated. Stop and report the blocker if a necessary external permission or resource is missing.
