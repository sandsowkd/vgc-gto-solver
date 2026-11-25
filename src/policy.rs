//! Baselines see the current perfect-information position, never a pending opponent choice.
use crate::actions::{self, JointAction};
use ninjask::{Battle, dex::types::Target, rng::Rng, state::SlotChoice};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "snake_case")]
pub enum PolicyKind {
    Random,
    #[default]
    Greedy,
    Tactical,
}

pub trait Policy {
    fn choose(&self, battle: &Battle, side: usize, rng: &mut Rng) -> crate::Result<JointAction>;
}

impl Policy for PolicyKind {
    fn choose(&self, b: &Battle, side: usize, rng: &mut Rng) -> crate::Result<JointAction> {
        // Enforce the interface invariant even when called from external library code.
        if b.sides.iter().any(|s| s.choice.is_some()) {
            return Err("policies must choose before either player's action is submitted".into());
        }
        let legal = actions::legal(b, side);
        if legal.is_empty() {
            return Err("no legal joint action".into());
        }
        if matches!(self, Self::Random) {
            return Ok(legal[rng.random(legal.len() as u32) as usize].clone());
        }
        // Evaluate each slot option once, then score the full Cartesian product.
        // This avoids running expensive damage calculations once per joint action.
        let mut probe = b.clone();
        let mut cache: Vec<(usize, SlotChoice, Features)> = Vec::new();
        for a in &legal {
            for (slot, &c) in a.iter().enumerate() {
                if !cache.iter().any(|(i, v, _)| *i == slot && *v == c) {
                    cache.push((
                        slot,
                        c,
                        features(&mut probe, side, slot, c, matches!(self, Self::Tactical)),
                    ));
                }
            }
        }
        let mut best = f64::NEG_INFINITY;
        let mut picks = Vec::new();
        for (index, a) in legal.iter().enumerate() {
            let mut damage = [0.0; 2];
            let mut ko = [0.0; 2];
            let mut score = 0.0;
            for (slot, c) in a.iter().enumerate() {
                let f = &cache
                    .iter()
                    .find(|(i, v, _)| *i == slot && v == c)
                    .unwrap()
                    .2;
                score += f.bonus;
                for j in 0..2 {
                    damage[j] += f.damage[j];
                    ko[j] += f.ko[j];
                }
            }
            for j in 0..2 {
                if let Some(t) = b.sides[1 - side].mons.get(j).filter(|m| !m.fainted) {
                    // Saturation penalizes wasting both attacks on a target already certain to faint.
                    score +=
                        damage[j].min(f64::from(t.hp)) / f64::from(t.maxhp) + 0.3 * ko[j].min(1.0);
                    if matches!(self, Self::Tactical) && damage[j] >= f64::from(t.hp) {
                        score += 0.2;
                    }
                }
            }
            if score > best + 1e-10 {
                best = score;
                picks.clear();
                picks.push(index);
            } else if (score - best).abs() < 1e-10 {
                picks.push(index);
            }
        }
        Ok(legal[picks[rng.random(picks.len() as u32) as usize]].clone())
    }
}

#[derive(Default)]
struct Features {
    damage: [f64; 2],
    ko: [f64; 2],
    bonus: f64,
}

fn features(b: &mut Battle, side: usize, slot: usize, c: SlotChoice, tactical: bool) -> Features {
    let mut f = Features::default();
    let SlotChoice::Move {
        slot: ms,
        target,
        mega,
    } = c
    else {
        return f;
    };
    let r = (side, slot);
    let m = b.mon(r);
    // Forced move slots are simulator sentinels; do not index them as ordinary moves.
    if m.vol.must_recharge > 0 {
        return f;
    }
    let id = if let Some(locked) = m.vol.two_turn.or(m.vol.locked_move) {
        Some(locked)
    } else if ms == ninjask::state::STRUGGLE {
        b.dex.move_id("struggle")
    } else {
        m.moves.get(ms).map(|s| s.id)
    };
    let Some(id) = id else {
        return f;
    };
    let mv = b.dex.mv(id).clone();
    let targets: Vec<_> = match mv.target {
        Target::AllAdjacent | Target::All => {
            b.all_active().into_iter().filter(|&t| t != r).collect()
        }
        Target::AllAdjacentFoes => b.all_active().into_iter().filter(|t| t.0 != side).collect(),
        _ if target > 0 => b
            .active(1 - side, (target - 1) as usize)
            .into_iter()
            .collect(),
        _ if target < 0 => b.active(side, (-target - 1) as usize).into_iter().collect(),
        Target::SelfTarget | Target::AllySide | Target::AllyTeam | Target::Allies => vec![r],
        _ => b.all_active().into_iter().filter(|t| t.0 != side).collect(),
    };
    let target_weight = if mv.target == Target::RandomNormal && !targets.is_empty() {
        1.0 / targets.len() as f64
    } else {
        1.0
    };
    for t in targets {
        if b.mon(t).fainted {
            continue;
        }
        let d = b.calc(r, id, t);
        if t.0 != side {
            f.damage[t.1] = d.expected * d.accuracy * target_weight;
            f.ko[t.1] = d.ko * target_weight;
            if tactical && d.damaging {
                let odds = b.order_odds(
                    r,
                    ninjask::calc::Plan::Move(id),
                    t,
                    ninjask::calc::Plan::Priority(0),
                );
                f.bonus += 0.05 * odds.first * d.ko;
            }
        } else if d.damaging {
            f.bonus -= d.expected * d.accuracy / f64::from(b.mon(t).maxhp);
        }
    }
    // Baseline preference only; root strategies always retain all Mega/non-Mega actions.
    if mega {
        f.bonus += 0.015;
    }
    if tactical {
        let hp = f64::from(b.mon(r).hp) / f64::from(b.mon(r).maxhp);
        match mv.id.as_str() {
            "recover" | "roost" | "slackoff" | "softboiled" | "synthesis" => {
                f.bonus += (1.0 - hp).min(0.5)
            }
            "tailwind" if b.sides[side].conds.tailwind == 0 => f.bonus += 0.16,
            "swordsdance" | "nastyplot" | "calmmind" | "dragondance" if hp > 0.6 => f.bonus += 0.12,
            "willowisp" | "thunderwave" | "spore" => f.bonus += 0.12,
            _ => {}
        }
    }
    f
}
