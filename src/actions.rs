//! Enumerate complete joint choices using the simulator's true legality.
use ninjask::{Battle, state::SlotChoice};
use serde::Serialize;

pub type JointAction = Vec<SlotChoice>;

#[derive(Clone, Debug, Serialize)]
pub struct ActionDescription {
    pub index: usize,
    pub choice: String,
    pub description: Vec<String>,
}

pub fn legal(b: &Battle, side: usize) -> Vec<JointAction> {
    b.joint_choices(side)
        .into_iter()
        .filter(|a| {
            b.request != ninjask::state::RequestState::Move
                || !a.iter().any(|c| matches!(c, SlotChoice::Switch { .. }))
        })
        .collect()
}

pub fn describe(b: &Battle, side: usize, actions: &[JointAction]) -> Vec<ActionDescription> {
    actions
        .iter()
        .enumerate()
        .map(|(index, a)| ActionDescription {
            index,
            choice: b.choice_string(a),
            description: a
                .iter()
                .enumerate()
                .map(|(i, c)| match c {
                    SlotChoice::Pass => "pass (empty or fainted slot)".into(),
                    SlotChoice::Switch { .. } => "switch".into(),
                    SlotChoice::Move { slot, target, mega } => {
                        let m = &b.sides[side].mons[i];
                        let name = m
                            .moves
                            .get(*slot)
                            .map(|s| b.dex.mv(s.id).name.as_str())
                            .unwrap_or("forced move / Struggle");
                        format!(
                            "{}: {}{} (target {})",
                            m.name,
                            name,
                            if *mega { " + Mega Evolution" } else { "" },
                            target
                        )
                    }
                })
                .collect(),
        })
        .collect()
}

/// Both choices must have been selected before calling; submission order reveals nothing to policies.
pub fn apply(b: &mut Battle, choices: [JointAction; 2]) {
    let needed = [b.side_needs_choice(0), b.side_needs_choice(1)];
    for (s, c) in choices.into_iter().enumerate() {
        if needed[s] {
            b.choose_structured(s, c);
        }
    }
}
