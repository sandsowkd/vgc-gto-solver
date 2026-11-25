use nashdex::{
    actions,
    battle::Position,
    matrix::{self, SamplingConfig},
    policy::{Policy, PolicyKind},
    rollout,
};
use ninjask::{rng::Rng, state::SlotChoice};
use serde_json::{Value, json};
fn position() -> Position {
    serde_json::from_str(include_str!("../examples/doubles.json")).unwrap()
}
fn small() -> Position {
    serde_json::from_str(include_str!("../examples/endgame.json")).unwrap()
}

#[test]
fn initializes_doubles_points_and_targets() {
    let b = position().build().unwrap();
    assert_eq!(b.turn, 1);
    assert_eq!(b.sides[0].mons.len(), 2);
    assert_eq!(b.sides[0].mons[0].maxhp, 185); // 108 + 2 + 75
    let a = actions::legal(&b, 0);
    for target in [1, 2, -2] {
        assert!(
            a.iter()
                .any(|c| matches!(c[0],SlotChoice::Move {slot:0,target:t,..} if t==target))
        );
    }
    assert!(a.iter().any(|c| matches!(
        c[0],
        SlotChoice::Move {
            slot: 1,
            target: 0,
            ..
        }
    ))); // spread
    assert!(a.iter().any(|c| matches!(
        c[0],
        SlotChoice::Move {
            slot: 3,
            target: 0,
            ..
        }
    ))); // Protect
    assert!(
        !a.iter()
            .flatten()
            .any(|c| matches!(c, SlotChoice::Switch { .. }))
    );
}
#[test]
fn all_enumerated_root_choices_are_accepted_by_text_parser() {
    let b = position().build().unwrap();
    for side in 0..2 {
        for c in actions::legal(&b, side) {
            let mut branch = b.clone();
            branch.choose(side, &b.choice_string(&c)).unwrap();
        }
    }
}
#[test]
fn ally_target_and_one_mega_per_side() {
    let mut p = position();
    p.teams.as_mut().unwrap()[0]=serde_json::from_value(json!([
        {"species":"Gardevoir","ability":"Trace","item":"Gardevoirite","moves":["Helping Hand","Protect"]},
        {"species":"Charizard","ability":"Blaze","item":"Charizardite Y","moves":["Heat Wave","Protect"]}
    ])).unwrap();
    let b = p.build().unwrap();
    let a = actions::legal(&b, 0);
    assert!(a.iter().any(|c| matches!(
        c[0],
        SlotChoice::Move {
            slot: 0,
            target: -2,
            ..
        }
    )));
    assert!(a.iter().any(|c| {
        c.iter()
            .any(|x| matches!(x, SlotChoice::Move { mega: true, .. }))
    }));
    assert!(a.iter().all(|c| {
        c.iter()
            .filter(|x| matches!(x, SlotChoice::Move { mega: true, .. }))
            .count()
            <= 1
    }));
}
#[test]
fn mega_and_protect_execute() {
    let mut b = position().build().unwrap();
    let hp = b.sides[1].mons[0].hp;
    b.choose(0, "move 1 1, move 1 1").unwrap();
    b.choose(1, "move 4 mega, move 4").unwrap();
    assert!(b.sides[1].mons[0].mega_evolved);
    assert!(b.sides[1].mega_used);
    assert_eq!(b.sides[1].mons[0].hp, hp); // no damaging weather for this side
    assert_eq!(
        b.dex.species(b.sides[1].mons[0].species).id,
        "charizardmegay"
    );
}
#[test]
fn fainted_slots_and_one_vs_two_work() {
    let mut p = position();
    p.teams.as_mut().unwrap()[0][1].hp = Some(0);
    let b = p.build().unwrap();
    assert_eq!(b.sides[0].pokemon_left, 1);
    assert!(
        actions::legal(&b, 0)
            .iter()
            .all(|a| a[1] == SlotChoice::Pass)
    );
    let r = rollout::play(&b, None, [PolicyKind::Random; 2], 17, 256, None).unwrap();
    assert!(r.utility.is_some());
    let b = small().build().unwrap();
    assert!(
        actions::legal(&b, 0)
            .iter()
            .all(|a| a[1] == SlotChoice::Pass)
    );
}
#[test]
fn state_clone_hash_and_projection_roundtrip() {
    let b = position().build().unwrap();
    let key = b.state_key();
    let mut copy = b.clone();
    copy.choose(0, "move 4, move 4").unwrap();
    assert_eq!(b.state_key(), key);
    assert_ne!(copy.state_key(), key);
    let mut p = position();
    p.teams = None;
    p.projection = Some(b.projection());
    let restored = p.build().unwrap();
    assert_eq!(restored.projection(), b.projection());
}
#[test]
fn damage_accuracy_priority_and_speed_tie() {
    let mut b = small().build().unwrap();
    let mv = b.sides[1].mons[0].moves[0].id;
    let d = b.calc((1, 0), mv, (0, 0));
    assert_eq!(d.hits[0].normal.len(), 16);
    assert!((d.accuracy - 0.95).abs() < 1e-12);
    assert!(d.hits[0].normal[0] >= d.hits[0].normal[15]);
    use ninjask::calc::Plan;
    assert_eq!(
        b.order_odds((0, 0), Plan::Priority(4), (1, 0), Plan::Priority(0))
            .first,
        1.0
    );
    b.sides[1].mons[0].stats[5] = b.sides[0].mons[0].stats[5];
    b.sides[1].mons[0].speed = b.sides[0].mons[0].speed;
    assert_eq!(
        b.order_odds((0, 0), Plan::Priority(0), (1, 0), Plan::Priority(0))
            .first,
        0.5
    );
}
#[test]
fn policy_does_not_mutate_or_read_pending_actions() {
    let mut b = position().build().unwrap();
    let before = b.state_key();
    for policy in [PolicyKind::Random, PolicyKind::Greedy, PolicyKind::Tactical] {
        let a = policy.choose(&b, 0, &mut Rng::new(1)).unwrap();
        assert!(actions::legal(&b, 0).contains(&a));
        assert_eq!(b.state_key(), before);
    }
    b.choose(1, "move 4, move 4").unwrap();
    assert!(PolicyKind::Greedy.choose(&b, 0, &mut Rng::new(1)).is_err());
}
#[test]
fn independent_streams_reproducible_across_threads() {
    let b = small().build().unwrap();
    let a = [actions::legal(&b, 0), actions::legal(&b, 1)];
    let c = SamplingConfig {
        samples_per_cell: 8,
        policies: [PolicyKind::Random; 2],
        threads: 1,
        ..Default::default()
    };
    let m = matrix::estimate(&b, &a, &c, None).unwrap();
    let n = matrix::estimate(&b, &a, &SamplingConfig { threads: 2, ..c }, None).unwrap();
    assert_eq!(m.cells, n.cells);
    assert_eq!(m.payoff, n.payoff);
}
#[test]
fn truncation_is_censored_and_missing_cells_are_not_zero() {
    let b = small().build().unwrap();
    let protect = actions::legal(&b, 0)
        .into_iter()
        .find(|a| matches!(a[0], SlotChoice::Move { slot: 1, .. }))
        .unwrap();
    let other = actions::legal(&b, 1)
        .into_iter()
        .find(|a| matches!(a[0], SlotChoice::Move { slot: 1, .. }))
        .unwrap();
    let m = matrix::estimate(
        &b,
        &[vec![protect], vec![other]],
        &SamplingConfig {
            samples_per_cell: 2,
            max_turns: 1,
            ..Default::default()
        },
        None,
    )
    .unwrap();
    assert_eq!(m.truncations, 2);
    assert!(m.payoff.is_none());
    assert_eq!(m.cells[0][0].draws, 0);
    let a = [actions::legal(&b, 0), actions::legal(&b, 1)];
    let m = matrix::estimate(
        &b,
        &a,
        &SamplingConfig::default(),
        Some(std::time::Instant::now()),
    )
    .unwrap();
    assert!(!m.coverage_complete);
    assert!(m.payoff.is_none());
    assert_eq!(m.samples, 0);
}
#[test]
fn unsupported_and_malformed_inputs_rejected() {
    let mut raw: Value = serde_json::from_str(include_str!("../examples/endgame.json")).unwrap();
    raw["teams"][0][0]["points"] = json!([33, 0, 0, 0, 0, 0]);
    assert!(
        serde_json::from_value::<Position>(raw)
            .unwrap()
            .build()
            .is_err()
    );
    let mut p = small();
    p.teams.as_mut().unwrap()[0][0].hp = Some(60000);
    assert!(p.build().is_err());
    let mut p = small();
    let extra = p.teams.as_ref().unwrap()[0][0].clone();
    p.teams.as_mut().unwrap()[0].push(extra);
    let extra = p.teams.as_ref().unwrap()[0][0].clone();
    p.teams.as_mut().unwrap()[0].push(extra);
    assert!(p.build().is_err());
}

#[test]
fn exact_chance_enumeration_validates_a_forced_win() {
    let mut p = small();
    p.teams.as_mut().unwrap()[1][0].hp = Some(1);
    let b = p.build().unwrap();
    let outcomes = b
        .enumerate_outcomes_text(
            "move 1 1, pass",
            "move 1 1, pass",
            ninjask::EnumerationMode::Precise,
        )
        .unwrap();
    assert!((outcomes.iter().map(|o| o.probability).sum::<f64>() - 1.0).abs() < 1e-12);
    assert!(
        outcomes
            .iter()
            .all(|o| o.battle.ended && o.battle.winner == Some(0))
    );
}

#[test]
fn entry_abilities_preserved_unless_stages_are_explicitly_overridden() {
    let p: Position = serde_json::from_str(include_str!("../examples/held-out.json")).unwrap();
    let b = p.build().unwrap();
    assert_eq!(b.sides[0].mons[0].boosts[0], -1);
    let mut q = p.clone();
    q.teams.as_mut().unwrap()[0][0].boosts = Some([0; 7]);
    assert_eq!(q.build().unwrap().sides[0].mons[0].boosts[0], 0);
}

#[test]
fn impossible_learnsets_are_rejected() {
    let mut p = small();
    p.teams.as_mut().unwrap()[0][0].moves = vec!["Thunderbolt".into()];
    assert!(p.build().unwrap_err().contains("cannot learn"));
}

#[test]
fn greedy_spread_damage_does_not_penalize_an_untargeted_ally() {
    let p: Position = serde_json::from_value(json!({"teams":[[
        {"species":"Charizard","ability":"Blaze","moves":["Heat Wave","Air Slash"]},
        {"species":"Scizor","ability":"Technician","moves":["Protect"]}
    ],[
        {"species":"Venusaur","ability":"Overgrow","moves":["Solar Beam"]},
        {"species":"Roserade","ability":"Natural Cure","moves":["Energy Ball"]}
    ]]}))
    .unwrap();
    let b = p.build().unwrap();
    let a = PolicyKind::Greedy.choose(&b, 0, &mut Rng::new(17)).unwrap();
    assert!(matches!(a[0], SlotChoice::Move { slot: 0, .. }));
}

#[test]
fn forced_struggle_and_charged_moves_are_enumerated() {
    let mut p = small();
    p.teams.as_mut().unwrap()[0][0].pp = Some(vec![0, 0]);
    let b = p.build().unwrap();
    assert!(actions::legal(&b, 0).iter().all(|a| matches!(
        a[0],
        SlotChoice::Move {
            slot: ninjask::state::STRUGGLE,
            ..
        }
    )));
    let mut p = small();
    p.teams.as_mut().unwrap()[1][0].moves = vec!["Air Slash".into(), "Solar Beam".into()];
    let mut b = p.build().unwrap();
    b.choose(0, "move 2, pass").unwrap();
    b.choose(1, "move 2 1, pass").unwrap();
    assert!(b.sides[1].mons[0].vol.two_turn.is_some());
    let choices = actions::legal(&b, 1);
    assert_eq!(choices.len(), 1);
    assert!(matches!(
        choices[0][0],
        SlotChoice::Move {
            slot: 0,
            target: 0,
            mega: false
        }
    ));
    b.choose(1, &b.choice_string(&choices[0])).unwrap();
}
