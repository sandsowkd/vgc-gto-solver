//! End-to-end root game estimation and equilibrium diagnostics.
use crate::{
    actions::{self, ActionDescription},
    battle::Position,
    matrix::{self, Estimate, SamplingConfig},
    solver::{self, Solution, SolverConfig},
};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SearchConfig {
    pub sampling: SamplingConfig,
    pub solver: SolverConfig,
    pub budget_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Runtime {
    pub initialization_ms: f64,
    pub enumeration_ms: f64,
    pub payoff_estimation_ms: f64,
    pub regret_minimization_ms: f64,
    pub total_ms: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct SearchResult {
    pub schema_version: u32,
    pub simulator_commit: String,
    pub showdown_commit: String,
    pub format: String,
    pub config: SearchConfig,
    pub interpretation: String,
    pub actions: [Vec<ActionDescription>; 2],
    pub matrix: Estimate,
    pub solution: Option<Solution>,
    /// Bound on x^T A_true y using simultaneous per-cell confidence bounds.
    pub strategy_utility_interval: Option<[f64; 2]>,
    /// Statistical upper bound on the returned pair's gap in the fixed-policy true root matrix.
    pub nash_gap_upper_confidence_bound: Option<f64>,
    pub warnings: Vec<String>,
    pub runtime: Runtime,
}
fn ms(t: Duration) -> f64 {
    t.as_secs_f64() * 1000.0
}

pub fn solve(position: &Position, config: &SearchConfig) -> crate::Result<SearchResult> {
    let start = Instant::now();
    config.solver.validate()?;
    if config.budget_ms == Some(0) {
        return Err("budget_ms must be positive".into());
    }
    let root = position.build()?;
    let init = start.elapsed();
    let t = Instant::now();
    let choices = [actions::legal(&root, 0), actions::legal(&root, 1)];
    let descriptions = [
        actions::describe(&root, 0, &choices[0]),
        actions::describe(&root, 1, &choices[1]),
    ];
    let enumeration = t.elapsed();
    let deadline = config
        .budget_ms
        .and_then(|b| start.checked_add(Duration::from_millis(b)));
    let sampling_deadline = config
        .budget_ms
        .and_then(|b| start.checked_add(Duration::from_secs_f64(b as f64 * 0.0009)));
    let t = Instant::now();
    let estimate = matrix::estimate(&root, &choices, &config.sampling, sampling_deadline)?;
    let sampling = t.elapsed();
    let t = Instant::now();
    let solution = estimate
        .payoff
        .as_ref()
        .map(|a| solver::solve_until(a, &config.solver, deadline))
        .transpose()?;
    let solving = t.elapsed();
    let mut interval = None;
    let mut upper_gap = None;
    if let Some(s) = &solution {
        let mut lo = 0.0;
        let mut hi = 0.0;
        let mut row_upper = vec![0.0; s.player1.len()];
        let mut col_lower = vec![0.0; s.player2.len()];
        for (i, row) in estimate.cells.iter().enumerate() {
            for (j, c) in row.iter().enumerate() {
                let [l, h] = c.utility_interval;
                let weight = s.player1[i] * s.player2[j];
                lo += weight * l;
                hi += weight * h;
                row_upper[i] += s.player2[j] * h;
                col_lower[j] += s.player1[i] * l;
            }
        }
        interval = Some([lo, hi]);
        upper_gap = Some(
            (row_upper.into_iter().fold(f64::NEG_INFINITY, f64::max)
                - col_lower.into_iter().fold(f64::INFINITY, f64::min))
            .clamp(0.0, 1.0),
        );
    }
    let mut warnings=vec!["Equilibrium applies only to the estimated root payoff matrix under the specified continuation policies; it is not a full-game Nash equilibrium.".into()];
    if !estimate.coverage_complete {
        warnings.push("Budget expired before every legal action pair had a completed sample. No mixed strategy is returned.".into());
    }
    if estimate.truncations > 0 {
        warnings.push("Some rollouts hit the turn/decision cap. They are censored, not draws. No point payoff matrix or mixed strategy is returned; inspect per-cell utility bounds.".into());
    }
    if !estimate.requested_samples_complete {
        warnings.push("Sampling stopped before the requested sample count. Fixed-work results are reproducible across thread counts; wall-clock results depend on scheduling.".into());
    }
    if solution.as_ref().is_some_and(|s| !s.converged) {
        warnings.push("Matrix solver stopped above the requested Nash-gap tolerance.".into());
    }
    Ok(SearchResult {schema_version:1,simulator_commit:crate::data::SIMULATOR_COMMIT.into(),showdown_commit:crate::data::SHOWDOWN_COMMIT.into(),
        format:crate::data::FORMAT.into(),config:config.clone(),interpretation:"Expected terminal win/loss/draw utility (1/0/0.5) after a root action pair, then fixed continuation policies. Utility includes draw credit; it is not strictly win probability.".into(),
        actions:descriptions,matrix:estimate,solution,strategy_utility_interval:interval,nash_gap_upper_confidence_bound:upper_gap,warnings,
        runtime:Runtime {initialization_ms:ms(init),enumeration_ms:ms(enumeration),payoff_estimation_ms:ms(sampling),regret_minimization_ms:ms(solving),total_ms:ms(start.elapsed())}})
}
