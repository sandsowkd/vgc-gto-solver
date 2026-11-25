//! Generic two-player constant-sum matrix games; no simulator dependencies.
use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "snake_case")]
pub enum Algorithm {
    RegretMatching,
    #[default]
    RegretMatchingPlus,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SolverConfig {
    pub iterations: u64,
    pub tolerance: f64,
    pub algorithm: Algorithm,
}
impl Default for SolverConfig {
    fn default() -> Self {
        Self {
            iterations: 50_000,
            tolerance: 0.001,
            algorithm: Algorithm::default(),
        }
    }
}
impl SolverConfig {
    pub fn validate(&self) -> crate::Result<()> {
        if self.iterations == 0 || !self.tolerance.is_finite() || self.tolerance < 0.0 {
            return Err("iterations must be positive and tolerance finite and nonnegative".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Solution {
    pub player1: Vec<f64>,
    pub player2: Vec<f64>,
    /// A y, in player one's utility.
    pub player1_action_values: Vec<f64>,
    /// A^T x: player two minimizes these values, expressed in player one's utility.
    pub player2_action_values_in_player1_utility: Vec<f64>,
    pub value: f64,
    pub lower_value: f64,
    pub upper_value: f64,
    pub nash_gap: f64,
    pub iterations: u64,
    pub converged: bool,
}

fn strategy(regrets: &[f64], out: &mut [f64]) {
    let total: f64 = regrets.iter().map(|r| r.max(0.0)).sum();
    let n = out.len() as f64;
    for (p, r) in out.iter_mut().zip(regrets) {
        *p = if total > 0.0 {
            r.max(0.0) / total
        } else {
            1.0 / n
        };
    }
}

pub fn validate(a: &[Vec<f64>]) -> crate::Result<(usize, usize)> {
    let n = a.first().map_or(0, Vec::len);
    if a.is_empty()
        || n == 0
        || a.iter()
            .any(|r| r.len() != n || r.iter().any(|v| !v.is_finite()))
    {
        return Err("payoff matrix must be nonempty, rectangular and finite".into());
    }
    // Prevent overflow of regrets/dot products even for arbitrary numeric input.
    if a.iter().flatten().any(|v| v.abs() > 1e100) {
        return Err("payoff magnitudes must be at most 1e100".into());
    }
    Ok((a.len(), n))
}

fn evaluate(a: &[Vec<f64>], x: Vec<f64>, y: Vec<f64>, iterations: u64, tolerance: f64) -> Solution {
    let rows: Vec<f64> = a
        .iter()
        .map(|r| r.iter().zip(&y).map(|(v, p)| v * p).sum())
        .collect();
    let mut cols = vec![0.0; y.len()];
    for (r, p) in a.iter().zip(&x) {
        for (v, c) in r.iter().zip(&mut cols) {
            *c += p * v;
        }
    }
    let value = x.iter().zip(&rows).map(|(p, v)| p * v).sum();
    let lower = cols.iter().copied().fold(f64::INFINITY, f64::min);
    let upper = rows.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let gap = (upper - lower).max(0.0);
    Solution {
        player1: x,
        player2: y,
        player1_action_values: rows,
        player2_action_values_in_player1_utility: cols,
        value,
        lower_value: lower,
        upper_value: upper,
        nash_gap: gap,
        iterations,
        converged: gap <= tolerance,
    }
}

pub fn solve(a: &[Vec<f64>], config: &SolverConfig) -> crate::Result<Solution> {
    solve_until(a, config, None)
}

pub fn solve_until(
    a: &[Vec<f64>],
    config: &SolverConfig,
    deadline: Option<Instant>,
) -> crate::Result<Solution> {
    let (m, n) = validate(a)?;
    config.validate()?;
    let (mut rx, mut ry) = (vec![0.0; m], vec![0.0; n]);
    let (mut x, mut y) = (vec![0.0; m], vec![0.0; n]);
    let (mut sx, mut sy) = (vec![0.0; m], vec![0.0; n]);
    let (mut rows, mut cols) = (vec![0.0; m], vec![0.0; n]);
    for t in 1..=config.iterations {
        strategy(&rx, &mut x);
        strategy(&ry, &mut y);
        rows.fill(0.0);
        cols.fill(0.0);
        for i in 0..m {
            for j in 0..n {
                rows[i] += a[i][j] * y[j];
                cols[j] += a[i][j] * x[i];
            }
        }
        let value: f64 = x.iter().zip(&rows).map(|(p, v)| p * v).sum();
        for i in 0..m {
            rx[i] += rows[i] - value;
            sx[i] += x[i];
        }
        for j in 0..n {
            ry[j] += value - cols[j];
            sy[j] += y[j];
        }
        if matches!(config.algorithm, Algorithm::RegretMatchingPlus) {
            rx.iter_mut().chain(&mut ry).for_each(|r| *r = r.max(0.0));
        }
        if t % 100 == 0 || t == config.iterations {
            let result = evaluate(
                a,
                sx.iter().map(|p| p / t as f64).collect(),
                sy.iter().map(|p| p / t as f64).collect(),
                t,
                config.tolerance,
            );
            if result.converged
                || t == config.iterations
                || deadline.is_some_and(|d| Instant::now() >= d)
            {
                return Ok(result);
            }
        }
    }
    unreachable!()
}
