//! Terminal-utility sampling. A cutoff is censored, never silently a draw.
use crate::{
    actions::{self, JointAction},
    policy::{Policy, PolicyKind},
};
use ninjask::{Battle, rng::Rng};
use serde::Serialize;
use std::time::Instant;

#[derive(Clone, Debug, Serialize)]
pub struct Rollout {
    pub utility: Option<f64>,
    pub turns: u32,
    pub decisions: u32,
    pub cancelled_for_budget: bool,
}

/// SplitMix64 finalizer: streams are a pure function of run, cell and sample.
pub fn mix(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9e3779b97f4a7c15);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
    z ^ (z >> 31)
}
pub fn sample_seed(seed: u64, cell: usize, sample: u64) -> u64 {
    mix(seed ^ mix(cell as u64) ^ mix(sample.wrapping_add(0x726f6c6c)))
}

pub fn play(
    root: &Battle,
    first: Option<[JointAction; 2]>,
    policies: [PolicyKind; 2],
    seed: u64,
    max_turns: u32,
    deadline: Option<Instant>,
) -> crate::Result<Rollout> {
    let mut b = root.clone();
    b.rng = Rng::new(mix(seed));
    let mut prng = [Rng::new(mix(seed ^ 0xa1)), Rng::new(mix(seed ^ 0xb2))];
    let start = b.turn;
    let mut decisions = 0;
    if let Some(c) = first {
        actions::apply(&mut b, c);
        decisions += 1;
    }
    while !b.ended
        && b.turn.saturating_sub(start) < max_turns
        && decisions < max_turns.saturating_mul(4)
    {
        if deadline.is_some_and(|d| Instant::now() >= d) {
            return Ok(Rollout {
                utility: None,
                turns: b.turn.saturating_sub(start),
                decisions,
                cancelled_for_budget: true,
            });
        }
        let a = policies[0].choose(&b, 0, &mut prng[0])?;
        let c = policies[1].choose(&b, 1, &mut prng[1])?;
        actions::apply(&mut b, [a, c]);
        decisions += 1;
    }
    Ok(Rollout {
        utility: if b.ended {
            Some(match b.winner {
                Some(0) => 1.0,
                Some(_) => 0.0,
                None => 0.5,
            })
        } else {
            None
        },
        turns: b.turn.saturating_sub(start),
        decisions,
        cancelled_for_budget: false,
    })
}
