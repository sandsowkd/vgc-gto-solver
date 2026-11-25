//! Measured microbenchmarks and side-swapped paired policy matches.
use crate::{
    actions,
    battle::Position,
    policy::{Policy, PolicyKind},
    rollout,
};
use ninjask::{Battle, rng::Rng};
use serde::{Deserialize, Serialize};
use std::{hint::black_box, time::Instant};

#[derive(Serialize)]
pub struct Microbench {
    pub iterations: u64,
    pub clone_ns: f64,
    pub joint_enumeration_ns: f64,
    pub battles: u64,
    pub completed_battles: u64,
    pub truncated_battles: u64,
    pub turns: u64,
    pub battles_per_second: f64,
    pub turns_per_second: f64,
    pub matrix_iterations_per_second: f64,
    pub policy: PolicyKind,
}

pub fn micro(
    position: &Position,
    iterations: u64,
    games: u64,
    policy: PolicyKind,
) -> crate::Result<Microbench> {
    if iterations == 0 || games == 0 {
        return Err("benchmark iterations and games must be positive".into());
    }
    let root = position.build()?;
    let t = Instant::now();
    for _ in 0..iterations {
        black_box(root.clone());
    }
    let clone_ns = t.elapsed().as_nanos() as f64 / iterations as f64;
    let t = Instant::now();
    for _ in 0..iterations {
        black_box(actions::legal(&root, 0));
        black_box(actions::legal(&root, 1));
    }
    let enumeration_ns = t.elapsed().as_nanos() as f64 / iterations as f64;
    let t = Instant::now();
    let mut turns = 0;
    let mut completed = 0;
    for g in 0..games {
        let r = rollout::play(&root, None, [policy; 2], rollout::mix(g), 256, None)?;
        turns += u64::from(r.turns);
        completed += u64::from(r.utility.is_some());
    }
    let seconds = t.elapsed().as_secs_f64();
    let config = crate::solver::SolverConfig {
        iterations: 100_000,
        tolerance: 0.0,
        ..Default::default()
    };
    let t = Instant::now();
    let s = crate::solver::solve(&[vec![0.7, 0.2, 0.8], vec![0.1, 0.9, 0.3]], &config)?;
    let solver_seconds = t.elapsed().as_secs_f64();
    Ok(Microbench {
        iterations,
        clone_ns,
        joint_enumeration_ns: enumeration_ns,
        battles: games,
        completed_battles: completed,
        truncated_battles: games - completed,
        turns,
        battles_per_second: games as f64 / seconds,
        turns_per_second: turns as f64 / seconds,
        matrix_iterations_per_second: s.iterations as f64 / solver_seconds,
        policy,
    })
}

#[derive(Serialize)]
pub struct MatchResult {
    pub policy_a: Agent,
    pub policy_b: Agent,
    pub solver_samples_per_cell: u64,
    pub seed: u64,
    pub side_swapped_pairs: u64,
    pub games: u64,
    pub wins: u64,
    pub losses: u64,
    pub draws: u64,
    pub truncated: u64,
    pub utility: Option<f64>,
    /// Hoeffding interval over independent pair averages (within-pair seeds are shared).
    pub paired_utility_interval_95: [f64; 2],
    pub runtime_ms: f64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "snake_case")]
pub enum Agent {
    Random,
    Greedy,
    Tactical,
    Solver,
}

fn choose(
    agent: Agent,
    b: &Battle,
    side: usize,
    rng: &mut Rng,
    solver_samples: u64,
) -> crate::Result<actions::JointAction> {
    match agent {
        Agent::Random => PolicyKind::Random.choose(b, side, rng),
        Agent::Greedy => PolicyKind::Greedy.choose(b, side, rng),
        Agent::Tactical => PolicyKind::Tactical.choose(b, side, rng),
        Agent::Solver => {
            let a = [actions::legal(b, 0), actions::legal(b, 1)];
            let config = crate::matrix::SamplingConfig {
                samples_per_cell: solver_samples,
                threads: 1,
                seed: rng.next_u64(),
                ..Default::default()
            };
            let estimate = crate::matrix::estimate(b, &a, &config, None)?;
            let payoff = estimate
                .payoff
                .ok_or("solver evaluation encountered a censored rollout")?;
            let solution = crate::solver::solve(
                &payoff,
                &crate::solver::SolverConfig {
                    iterations: 10_000,
                    tolerance: 0.005,
                    ..Default::default()
                },
            )?;
            let strategy = if side == 0 {
                solution.player1
            } else {
                solution.player2
            };
            let mut u = f64::from(rng.next_u32()) / 4294967296.0;
            for (i, p) in strategy.iter().enumerate() {
                u -= p;
                if u <= 0.0 {
                    return Ok(a[side][i].clone());
                }
            }
            Ok(a[side].last().unwrap().clone())
        }
    }
}

fn agent_game(
    root: &Battle,
    agents: [Agent; 2],
    seed: u64,
    solver_samples: u64,
) -> crate::Result<Option<f64>> {
    let mut b = root.clone();
    b.rng = Rng::new(rollout::mix(seed));
    let mut rng = [
        Rng::new(rollout::mix(seed ^ 0xa1)),
        Rng::new(rollout::mix(seed ^ 0xb2)),
    ];
    let start = b.turn;
    let mut decisions = 0;
    while !b.ended && b.turn.saturating_sub(start) < 256 && decisions < 1024 {
        let a = choose(agents[0], &b, 0, &mut rng[0], solver_samples)?;
        let c = choose(agents[1], &b, 1, &mut rng[1], solver_samples)?;
        actions::apply(&mut b, [a, c]);
        decisions += 1;
    }
    Ok(b.ended.then_some(match b.winner {
        Some(0) => 1.0,
        Some(_) => 0.0,
        None => 0.5,
    }))
}

pub fn matches(
    position: &Position,
    a: Agent,
    b: Agent,
    pairs: u64,
    seed: u64,
    solver_samples: u64,
) -> crate::Result<MatchResult> {
    if pairs == 0 || solver_samples == 0 {
        return Err("pairs and solver_samples must be positive".into());
    }
    let root = position.build()?;
    let start = Instant::now();
    let (mut wins, mut losses, mut draws, mut truncated) = (0, 0, 0, 0);
    // Swap policy assignments instead of mutating battle-side bookkeeping.
    // This gives policy A one game with each team on the same initial board.
    for pair in 0..pairs {
        for swap in [false, true] {
            let policies = if swap { [b, a] } else { [a, b] };
            let result = agent_game(&root, policies, rollout::mix(seed ^ pair), solver_samples)?;
            let utility = result.map(|u| if swap { 1.0 - u } else { u });
            match utility {
                Some(1.0) => wins += 1,
                Some(0.0) => losses += 1,
                Some(_) => draws += 1,
                None => truncated += 1,
            }
        }
    }
    let count = 2 * pairs;
    let low = (wins as f64 + 0.5 * draws as f64) / count as f64;
    let high = low + truncated as f64 / count as f64;
    let radius = (40.0_f64.ln() / (2.0 * pairs as f64)).sqrt();
    Ok(MatchResult {
        policy_a: a,
        policy_b: b,
        solver_samples_per_cell: solver_samples,
        seed,
        side_swapped_pairs: pairs,
        games: count,
        wins,
        losses,
        draws,
        truncated,
        utility: (truncated == 0).then_some(low),
        paired_utility_interval_95: [(low - radius).max(0.0), (high + radius).min(1.0)],
        runtime_ms: start.elapsed().as_secs_f64() * 1000.0,
    })
}
