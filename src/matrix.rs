//! Reproducible independent Monte Carlo streams and explicit censoring bounds.
use crate::{actions::JointAction, policy::PolicyKind, rollout};
use ninjask::Battle;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SamplingConfig {
    pub samples_per_cell: u64,
    pub max_turns: u32,
    pub seed: u64,
    pub threads: usize,
    pub policies: [PolicyKind; 2],
    pub confidence: f64,
}
impl Default for SamplingConfig {
    fn default() -> Self {
        Self {
            samples_per_cell: 32,
            max_turns: 256,
            seed: 1,
            threads: 0,
            policies: [PolicyKind::Greedy; 2],
            confidence: 0.95,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct Cell {
    pub samples: u64,
    pub wins: u64,
    pub losses: u64,
    pub draws: u64,
    pub truncated: u64,
    pub cancelled_for_budget: u64,
    pub simulated_turns: u64,
    pub simulated_decisions: u64,
    pub completed_mean: Option<f64>,
    /// Defined only when every attempted rollout terminates.
    pub mean: Option<f64>,
    pub standard_error: Option<f64>,
    pub utility_interval: [f64; 2],
}
impl Cell {
    pub fn finish(&mut self, cells: usize, confidence: f64) {
        let complete = self.wins + self.losses + self.draws;
        let sum = self.wins as f64 + 0.5 * self.draws as f64;
        self.completed_mean = (complete > 0).then(|| sum / complete as f64);
        self.mean = (self.samples > 0 && self.truncated == 0).then(|| sum / self.samples as f64);
        self.standard_error = if self.truncated == 0 && complete > 1 {
            let sum2 = self.wins as f64 + 0.25 * self.draws as f64;
            Some(
                ((sum2 - sum * sum / complete as f64).max(0.0)
                    / (complete - 1) as f64
                    / complete as f64)
                    .sqrt(),
            )
        } else {
            None
        };
        self.utility_interval = if self.samples == 0 {
            [0.0, 1.0]
        } else {
            let n = self.samples as f64;
            // Union over both censoring endpoints, all cells, and all sample counts.
            // Sum 1/[n(n+1)] = 1: valid under budget-dependent stopping as well.
            let radius =
                ((4.0 * cells as f64 * n * (n + 1.0) / (1.0 - confidence)).ln() / (2.0 * n)).sqrt();
            [
                (sum / n - radius).max(0.0),
                ((sum + self.truncated as f64) / n + radius).min(1.0),
            ]
        };
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Estimate {
    pub rows: usize,
    pub columns: usize,
    pub cells: Vec<Vec<Cell>>,
    pub payoff: Option<Vec<Vec<f64>>>,
    pub coverage_complete: bool,
    pub requested_samples_complete: bool,
    pub samples: u64,
    pub truncations: u64,
    pub cancelled_for_budget: u64,
    pub truncation_rate: f64,
    pub confidence: f64,
    pub interval_method: String,
}

pub fn estimate(
    root: &Battle,
    actions: &[Vec<JointAction>; 2],
    config: &SamplingConfig,
    deadline: Option<Instant>,
) -> crate::Result<Estimate> {
    estimate_controlled(root, actions, config, deadline, None)
}

pub fn estimate_controlled(
    root: &Battle,
    actions: &[Vec<JointAction>; 2],
    config: &SamplingConfig,
    deadline: Option<Instant>,
    control: Option<&crate::control::Control>,
) -> crate::Result<Estimate> {
    use std::sync::atomic::Ordering;
    if config.samples_per_cell == 0
        || config.max_turns == 0
        || config.confidence <= 0.0
        || config.confidence >= 1.0
        || !config.confidence.is_finite()
    {
        return Err(
            "samples/max_turns must be positive; confidence must lie strictly between 0 and 1"
                .into(),
        );
    }
    let (m, n) = (actions[0].len(), actions[1].len());
    if m == 0 || n == 0 {
        return Err("both sides need legal actions".into());
    }
    if let Some(c) = control {
        c.total.store((m * n) as u64, Ordering::Relaxed);
        c.phase.store(1, Ordering::Relaxed);
    }
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(config.threads)
        .build()
        .map_err(|e| e.to_string())?;
    let mut cells = vec![Cell::default(); m * n];
    // One complete sweep before refinement: no action is pruned to meet a budget.
    for round in 0..config.samples_per_cell {
        if let Some(c) = control {
            c.check()?;
        }
        if deadline.is_some_and(|d| Instant::now() >= d) {
            break;
        }
        let results: Vec<crate::Result<()>> = pool.install(|| {
            cells
                .par_iter_mut()
                .enumerate()
                .map(|(index, cell)| {
                    if let Some(c) = control {
                        c.check()?;
                    }
                    if deadline.is_some_and(|d| Instant::now() >= d) {
                        return Ok(());
                    }
                    let first = [actions[0][index / n].clone(), actions[1][index % n].clone()];
                    let result = rollout::play_controlled(
                        root,
                        Some(first),
                        config.policies,
                        rollout::sample_seed(config.seed, index, round),
                        config.max_turns,
                        None,
                        control,
                    )?;
                    cell.simulated_turns += u64::from(result.turns);
                    cell.simulated_decisions += u64::from(result.decisions);
                    if result.cancelled_for_budget {
                        cell.cancelled_for_budget += 1;
                        return Ok(());
                    }
                    if let Some(c) = control {
                        c.samples.fetch_add(1, Ordering::Relaxed);
                        if cell.samples == 0 {
                            c.covered.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    cell.samples += 1;
                    match result.utility {
                        Some(1.0) => cell.wins += 1,
                        Some(0.0) => cell.losses += 1,
                        Some(_) => cell.draws += 1,
                        None => cell.truncated += 1,
                    }
                    Ok(())
                })
                .collect()
        });
        for r in results {
            r?;
        }
    }
    for c in &mut cells {
        c.finish(m * n, config.confidence);
    }
    let coverage = cells.iter().all(|c| c.samples > 0);
    let complete = cells.iter().all(|c| c.samples == config.samples_per_cell);
    let payoff: Option<Vec<Vec<f64>>> = cells
        .chunks(n)
        .map(|r| r.iter().map(|c| c.mean).collect())
        .collect();
    let samples = cells.iter().map(|c| c.samples).sum::<u64>();
    let truncated = cells.iter().map(|c| c.truncated).sum();
    Ok(Estimate {rows:m,columns:n,samples,truncations:truncated,
        cancelled_for_budget:cells.iter().map(|c|c.cancelled_for_budget).sum(),
        truncation_rate:if samples>0 {truncated as f64/samples as f64}else{0.0},
        cells:cells.chunks(n).map(|r|r.to_vec()).collect(), payoff,
        coverage_complete:coverage,requested_samples_complete:complete,confidence:config.confidence,
        interval_method:"simultaneous anytime Hoeffding bounds across cells and sample counts, with censoring endpoints".into()})
}
