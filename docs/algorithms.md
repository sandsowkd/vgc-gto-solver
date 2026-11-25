# Mathematical and statistical contract

At the root, player one selects a complete joint action `a` and player two selects `b`
simultaneously. The initial implementation estimates

`A[a,b] = E[u(terminal battle) | root, a, b, continuation policies π1, π2]`.

Terminal utility is win=1, loss=0, draw=0.5. No HP/damage heuristic enters this payoff.
Draw credit means expected utility is not exactly win probability. Per-cell win/loss/draw
counts are available separately. Greedy damage is a **continuation policy**, not the objective.

Every rollout clones the root, reseeds the simulator independently of both policy RNGs,
applies both selected root actions, and continues to termination. Policies select both
joint actions before either is submitted to the simulator. A `Policy` implementation cannot
be called on a state containing a pending choice. Full information about both sets is intentional.

## Matrix game

For strategies x and y, row values are `Ay`, column values in player one's utility are `Aᵀx`,
and current value is `v=xᵀAy`. Update external regrets by

```
R1 += Ay - v
R2 += v - Aᵀx
```

Regret matching normalizes positive regrets, using the uniform strategy when their sum is zero.
RM+ additionally clips cumulative regrets to zero after each simultaneous update. Both players'
strategies are averaged uniformly across iterations. This is regret matching plus, inspired by
CFR+'s clipping; it is not an implementation of extensive-form CFR or CFR+'s full alternating,
linearly weighted schedule. No game tree or information sets are traversed.

The reported solution uses the average strategies. Its exact best-response diagnostic on
the supplied matrix is

`gap = max_i (Ay)_i - min_j (Aᵀx)_j`.

The game value lies between `min(Aᵀx)` and `max(Ay)`. The solver checks the gap every 100 iterations,
stopping at tolerance, iteration cap or its cooperative deadline. Player two's output column
EVs are explicitly in player one's utility; subtract from one for player two's battle utility.
The generic solver also accepts arbitrary finite signed payoffs, where this complement has
no special interpretation.

Analytical tests cover RPS, matching pennies, a saddle point, domination, nonuniform equilibria,
rectangular games, signed payoffs and transpose/complement symmetry. `scripts/validate_lp.py`
independently maximizes v subject to `Aᵀx ≥ v`, `sum(x)=1`, `x≥0` with SciPy/HiGHS. Random-game
records and exact installed reference versions are saved under `benchmarks/`.

## Sampling, confidence and censoring

Fixed-work sweeps sample **every** legal root pair once before refining any pair for a second
round. Each stream is a deterministic function of run seed, row/column index and sample index,
using SplitMix64 mixing and the engine's xoshiro256++ generator. Separate streams drive policy
choices. No shared RNG or floating-point parallel reduction affects fixed-work outputs.

For each cell, n attempted rollouts yield observed terminal utility sum S and c capped games.
The unknown contribution from capped games lies in `[0,c]`. The empirical censoring interval
is `[S/n, (S+c)/n]`. The completed-only mean is diagnostic and may be biased if c>0. No point
payoff or strategy is returned when any cell is unsampled or has censored games. A capped game
never increments draw counts. Turn and decision caps are both enforced.

With K cells and requested joint confidence `1-α`, the interval radius at sample count n is

`ε(n) = sqrt(log(4 K n(n+1)/α)/(2n))`.

Apply Hoeffding to the lower/upper bounded observations, union over endpoints/cells and all n
using `sum_n 1/(n(n+1))=1`, then clip the interval to `[0,1]`. These conservative simultaneous,
anytime intervals remain valid when a time budget changes the final sample counts. They assume
independent pseudorandom streams with the simulator's correct outcome distribution. They do not
cover simulator bugs, poor continuation policies or differences from official game behavior.

An empirical standard error is also returned for uncensored cells with at least two samples.
Zero empirical variance is not a certificate of zero uncertainty; use the bounded intervals.
The strategy utility interval sums simultaneous cell bounds with weights x_i y_j. A statistical
gap upper bound uses `max_i Σ_j y_j U_ij - min_j Σ_i x_i L_ij`. This can remain large even when
the estimated matrix gap is tiny, and does not certify a full-game equilibrium.

Soft budgets reserve 90% for initialization/sampling and 10% for regret minimization. Sampling
checks time before starting each rollout and completes every started sample to avoid selectively
discarding slow outcomes. A long rollout, Rayon setup, a 100-iteration solver block, output
serialization and process startup can overshoot the requested time. Timing breakdowns exclude
CLI input parsing and output serialization. Incomplete coverage is explicit; no action is pruned.

## Continuations and evaluation

Random selects uniformly among legal joint actions. Greedy caches damage/accuracy/KO features
per slot option using Ninjask's calculator, then scores complete joint actions with damage
saturation to discourage overkill and a penalty for damaging allies. It has a small explicit
preference for Mega Evolution; it does not recalculate hypothetical Mega forms before choosing.
Tactical adds modest turn-order, recovery, setup, status and Tailwind bonuses. These are initial
heuristics. Protect timing, redirection, survival, setup synergy and value under alternative
continuations need substantially better modeling. Called moves and forced continuations are
executed by the engine even where heuristic feature estimates are crude.

`match --a solver` re-estimates and re-solves at every decision, sampling the resulting joint
strategy. Its continuation is still greedy; its samples/iteration cap are reported/documented.
Both policy assignments are played on the original board for each seed, so each policy receives
both teams without unsafe state mutation. The confidence interval treats the two games as one
bounded paired observation. Seeds are independent across pairs. A held-out flag identifies
positions excluded from the initial design fixture. This small authored suite is not a sample
of a tournament metagame, so the results cannot establish competitive playing strength.

## References

- [Regret matching, Hart and Mas-Colell](https://www.ma.huji.ac.il/hart/papers/regret.pdf)
- [Solving large imperfect information games using CFR+, Tammelin](https://arxiv.org/abs/1407.5042)
- [SciPy linprog/HiGHS reference](https://docs.scipy.org/doc/scipy/reference/optimize.linprog-highs.html)

The next search improvement should be evaluated on held-out positions and multiple continuation
opponents, with both payoff uncertainty and strategy stability reported.
