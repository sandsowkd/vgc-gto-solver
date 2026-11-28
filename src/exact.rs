//! Bounded, full-information game-value reference for tiny positions.
use crate::{Result, actions, battle::Position, solver};
use ninjask::{Battle, EnumerationMode};
use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Limits {
    pub decisions: u8,
    pub action_pairs: usize,
    pub chance_paths_per_pair: u64,
}

#[derive(Debug, Default, Serialize)]
pub struct Work {
    pub action_pairs: usize,
    pub terminal_leaves: usize,
    pub horizon_cutoffs: usize,
    pub action_pair_cutoffs: usize,
    pub chance_path_cutoffs: usize,
}

#[derive(Debug, Serialize)]
pub struct Reference {
    pub simulator_commit: &'static str,
    pub format: &'static str,
    pub limits: Limits,
    pub work: Work,
    /// Lower and upper bounds on optimal full-information player-one terminal utility.
    pub game_value_interval: [f64; 2],
}

pub fn evaluate(position: &Position, limits: Limits) -> Result<Reference> {
    if !(1..=16).contains(&limits.decisions)
        || !(1..=10_000).contains(&limits.action_pairs)
        || !(1..=100_000).contains(&limits.chance_paths_per_pair)
    {
        return Err("Exact reference limits: decisions 1–16, action pairs 1–10000, chance paths/pair 1–100000".into());
    }
    let root = position.build()?;
    let mut remaining_pairs = limits.action_pairs;
    let mut work = Work::default();
    let interval = bounds(
        &root,
        limits.decisions,
        limits.chance_paths_per_pair,
        &mut remaining_pairs,
        &mut work,
    )?;
    Ok(Reference {
        simulator_commit: crate::data::SIMULATOR_COMMIT,
        format: crate::data::FORMAT,
        limits,
        work,
        game_value_interval: interval,
    })
}

const UNRESOLVED: [f64; 2] = [0.0, 1.0];

fn bounds(
    battle: &Battle,
    depth: u8,
    chance_paths: u64,
    remaining_pairs: &mut usize,
    work: &mut Work,
) -> Result<[f64; 2]> {
    if battle.ended {
        work.terminal_leaves += 1;
        let utility = match battle.winner {
            Some(0) => 1.0,
            Some(_) => 0.0,
            None => 0.5,
        };
        return Ok([utility; 2]);
    }
    if depth == 0 {
        work.horizon_cutoffs += 1;
        return Ok(UNRESOLVED);
    }
    let rows = actions::legal(battle, 0);
    let columns = actions::legal(battle, 1);
    let pairs = rows.len().saturating_mul(columns.len());
    if pairs == 0 {
        return Err("exact reference reached a nonterminal state without legal choices".into());
    }
    if pairs > *remaining_pairs {
        work.action_pair_cutoffs += 1;
        return Ok(UNRESOLVED);
    }
    // Reserve enough budget to visit every pair at this node before descending.
    *remaining_pairs -= pairs;
    work.action_pairs += pairs;

    let mut lower = vec![vec![0.0; columns.len()]; rows.len()];
    let mut upper = lower.clone();
    for (i, row) in rows.iter().enumerate() {
        for (j, column) in columns.iter().enumerate() {
            let outcomes = match battle.enumerate_outcomes_within(
                row,
                column,
                EnumerationMode::Precise,
                chance_paths,
            ) {
                Ok(outcomes) => outcomes,
                Err(error) if error.0.contains("chance paths (max_paths)") => {
                    work.chance_path_cutoffs += 1;
                    upper[i][j] = 1.0;
                    continue;
                }
                Err(error) => return Err(format!("exact chance enumeration failed: {error}")),
            };
            let mass: f64 = outcomes.iter().map(|outcome| outcome.probability).sum();
            if (mass - 1.0).abs() > 1e-9
                || outcomes
                    .iter()
                    .any(|outcome| !(0.0..=1.0 + 1e-9).contains(&outcome.probability))
            {
                return Err(format!(
                    "exact chance enumeration returned invalid mass {mass}"
                ));
            }
            for outcome in outcomes {
                let [lo, hi] = bounds(
                    &outcome.battle,
                    depth - 1,
                    chance_paths,
                    remaining_pairs,
                    work,
                )?;
                let weight = outcome.probability / mass;
                lower[i][j] += weight * lo;
                upper[i][j] += weight * hi;
            }
        }
    }

    // Use certificates from unilateral best responses, not the numerical value
    // of an unconverged matrix iteration. Monotonicity transfers both bounds.
    let config = solver::SolverConfig::default();
    let pessimistic = solver::solve(&lower, &config)?;
    let high = if lower == upper {
        pessimistic.upper_value
    } else {
        solver::solve(&upper, &config)?.upper_value
    };
    // Round outward to allow for floating-point accumulation of chance mass.
    const ROUND_OFF: f64 = 1e-12;
    Ok([
        (pessimistic.lower_value - ROUND_OFF).clamp(0.0, 1.0),
        (high + ROUND_OFF).clamp(0.0, 1.0),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deeper_reference_resolves_the_two_hit_race() {
        let position = serde_json::from_str(include_str!("../examples/two-hit-race.json")).unwrap();
        let mut limits = Limits {
            decisions: 1,
            action_pairs: 256,
            chance_paths_per_pair: 1024,
        };
        assert_eq!(
            evaluate(&position, limits).unwrap().game_value_interval,
            UNRESOLVED
        );
        limits.decisions = 2;
        let result = evaluate(&position, limits).unwrap();
        assert!((result.game_value_interval[0] - 1.0).abs() < 1e-9);
        assert_eq!(result.game_value_interval[1], 1.0);
        assert_eq!(result.work.horizon_cutoffs, 0);
        assert!(result.work.action_pairs >= 2);
        limits.action_pairs = 1;
        let exhausted = evaluate(&position, limits).unwrap();
        assert_eq!(exhausted.game_value_interval, UNRESOLVED);
        assert!(exhausted.work.action_pair_cutoffs > 0);
    }
}
