//! Validated team input and decision-boundary battle construction.
use crate::{Result, data};
use ninjask::{
    Battle,
    dex::types::Status,
    dex::{
        support,
        team::{MonSet, parse_packed},
    },
    rng::Rng,
    state::{RequestState, Terrain, Weather},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pokemon {
    pub species: String,
    pub ability: String,
    #[serde(default)]
    pub item: Option<String>,
    pub moves: Vec<String>,
    #[serde(default = "hardy")]
    pub nature: String,
    /// HP, Attack, Defense, Special Attack, Special Defense, Speed; Champions points, not EVs.
    #[serde(default)]
    pub points: [u16; 6],
    #[serde(default)]
    pub hp: Option<u16>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub status_turns: u8,
    #[serde(default)]
    pub toxic_stage: u8,
    #[serde(default)]
    pub boosts: Option<[i8; 7]>,
    #[serde(default)]
    pub pp: Option<Vec<u8>>,
    #[serde(default)]
    pub active_turns: Option<u16>,
}
fn hardy() -> String {
    "Hardy".into()
}
fn seed() -> u64 {
    1
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Field {
    pub weather: Option<String>,
    #[serde(default)]
    pub weather_turns: u8,
    pub terrain: Option<String>,
    #[serde(default)]
    pub terrain_turns: u8,
    #[serde(default)]
    pub trick_room: u8,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SideConditions {
    #[serde(default)]
    pub tailwind: u8,
    #[serde(default)]
    pub reflect: u8,
    #[serde(default)]
    pub light_screen: u8,
    #[serde(default)]
    pub aurora_veil: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Position {
    /// Exactly one input must be supplied. On each team, the first two sets lead.
    #[serde(default)]
    pub teams: Option<[Vec<Pokemon>; 2]>,
    #[serde(default)]
    pub packed_teams: Option<[String; 2]>,
    /// Advanced: Ninjask/Showdown projection at a move boundary, with an empty queue.
    #[serde(default)]
    pub projection: Option<Value>,
    #[serde(default = "seed")]
    pub seed: u64,
    /// Differential testing only: use Showdown's reference generator instead of xoshiro.
    #[serde(default)]
    pub reference_seed: Option<String>,
    #[serde(default)]
    pub replay: Vec<[String; 2]>,
    #[serde(default)]
    pub field: Option<Field>,
    #[serde(default)]
    pub side_conditions: Option<[SideConditions; 2]>,
    #[serde(default)]
    pub turn: Option<u32>,
}

fn set(p: &Pokemon) -> Result<MonSet> {
    let dex = data::dex();
    let species = dex
        .species_id(&p.species)
        .ok_or_else(|| format!("unknown species {}", p.species))?;
    if dex.species(species).battle_only {
        return Err("start with a base species; Mega Evolve via an action".into());
    }
    let ability = dex
        .ability_id(&p.ability)
        .ok_or_else(|| format!("unknown ability {}", p.ability))?;
    if !dex
        .species(species)
        .abilities
        .iter()
        .any(|(_, a)| data::id(a) == data::id(&p.ability))
    {
        return Err(format!("{} cannot have ability {}", p.species, p.ability));
    }
    let item = p
        .item
        .as_ref()
        .map(|s| dex.item_id(s).ok_or_else(|| format!("unknown item {s}")))
        .transpose()?;
    if p.moves.is_empty() || p.moves.len() > 4 {
        return Err("each Pokémon needs 1–4 moves".into());
    }
    let moves: Vec<_> = p
        .moves
        .iter()
        .map(|s| dex.move_id(s).ok_or_else(|| format!("unknown move {s}")))
        .collect::<Result<_>>()?;
    for (i, m) in moves.iter().enumerate() {
        if moves[..i].contains(m) {
            return Err("duplicate move".into());
        }
        if matches!(
            support::move_support(&dex, dex.mv(*m)),
            ninjask::dex::types::Support::Unsupported(_)
        ) {
            return Err(format!("unsupported move {}", dex.mv(*m).name));
        }
    }
    if matches!(
        support::ability_support(&dex, ability),
        ninjask::dex::types::Support::Unsupported(_)
    ) || matches!(
        support::item_support(&dex, item),
        ninjask::dex::types::Support::Unsupported(_)
    ) {
        return Err("ability or item is unsupported by pinned simulator".into());
    }
    if ninjask::dex::team::nature_name(&p.nature).is_empty() {
        return Err(format!("unknown nature {}", p.nature));
    }
    if p.points.iter().any(|&x| x > 32) || p.points.iter().map(|&v| u32::from(v)).sum::<u32>() > 66
    {
        return Err("Champions stat points allow at most 32 per stat and 66 total".into());
    }
    if p.boosts
        .as_ref()
        .is_some_and(|b| b.iter().any(|x| !(-6..=6).contains(x)))
    {
        return Err("stat stages must be in -6..6".into());
    }
    Ok(MonSet {
        nickname: String::new(),
        species,
        item,
        ability,
        moves,
        nature: p.nature.clone(),
        points: p.points,
        gender: String::new(),
        level: 50,
        shiny: false,
    })
}

/// Validate a complete UI/import set against pinned native legality.
pub fn checked_set(p: &Pokemon) -> Result<MonSet> {
    let mon = set(p)?;
    validate_set(&mon)?;
    Ok(mon)
}

impl Position {
    pub fn build(&self) -> Result<Battle> {
        let dex = data::dex();
        if [
            self.teams.is_some(),
            self.packed_teams.is_some(),
            self.projection.is_some(),
        ]
        .iter()
        .filter(|&&v| v)
        .count()
            != 1
        {
            return Err("supply exactly one of teams, packed_teams or projection".into());
        }
        let mut b = if let Some(p) = &self.projection {
            validate_projection(p)?;
            if self.reference_seed.is_some() {
                return Err("reference_seed cannot restore a projection's RNG history; replay teams instead".into());
            }
            Battle::from_projection(dex.clone(), p, ["p1", "p2"], self.seed)?
        } else {
            let sets: [Vec<MonSet>; 2] = if let Some(t) = &self.teams {
                [
                    t[0].iter().map(set).collect::<Result<_>>()?,
                    t[1].iter().map(set).collect::<Result<_>>()?,
                ]
            } else {
                let t = self.packed_teams.as_ref().unwrap();
                for team in t {
                    for chunk in team.split(']').filter(|c| !c.is_empty()) {
                        if let Some(points) = chunk.split('|').nth(6).filter(|s| !s.is_empty()) {
                            let fields: Vec<_> = points.split(',').collect();
                            if fields.len() > 6
                                || fields
                                    .iter()
                                    .any(|s| !s.is_empty() && s.parse::<u16>().is_err())
                            {
                                return Err(
                                    "packed stat points must be at most six unsigned integers"
                                        .into(),
                                );
                            }
                        }
                    }
                    let problems = support::team_problems(&dex, team)?;
                    if !problems.is_empty() {
                        return Err(problems.join("; "));
                    }
                }
                [parse_packed(&dex, &t[0])?, parse_packed(&dex, &t[1])?]
            };
            if sets.iter().any(|t| t.is_empty() || t.len() > 4) {
                return Err("each side must contain 1–4 Pokémon".into());
            }
            for team in &sets {
                for mon in team {
                    validate_set(mon)?;
                }
            }
            let rng = self
                .reference_seed
                .as_ref()
                .map(|s| Rng::from_showdown_seed(s))
                .transpose()?
                .unwrap_or_else(|| Rng::new(self.seed));
            let mut b = Battle::from_sets_rng(dex, [&sets[0], &sets[1]], ["p1", "p2"], rng);
            b.log_enabled = false;
            b.log.clear();
            b.choose_team(0, (0..sets[0].len()).collect());
            b.choose_team(1, (0..sets[1].len()).collect());
            if let Some(teams) = &self.teams {
                for (s, team) in teams.iter().enumerate() {
                    for (i, p) in team.iter().enumerate() {
                        let m = &mut b.sides[s].mons[i];
                        if let Some(hp) = p.hp {
                            if hp > m.maxhp {
                                return Err(format!(
                                    "{} HP exceeds maximum {}",
                                    p.species, m.maxhp
                                ));
                            }
                            m.hp = hp;
                            m.fainted = hp == 0;
                        }
                        if let Some(status) = &p.status {
                            m.status = Status::from_id(status)
                                .ok_or_else(|| format!("unknown status {status}"))?;
                            if m.status == Status::Fnt && !m.fainted {
                                return Err("fnt status requires hp=0".into());
                            }
                            m.status_state = m.status;
                            m.status_time = p.status_turns;
                            m.status_start_time = p.status_turns;
                            m.toxic_stage = p.toxic_stage;
                        }
                        if let Some(boosts) = p.boosts {
                            m.boosts = boosts;
                        }
                        if let Some(pp) = &p.pp {
                            if pp.len() != m.moves.len() {
                                return Err("PP array must match moves".into());
                            }
                            for (slot, &remaining) in m.moves.iter_mut().zip(pp) {
                                if remaining > slot.max_pp {
                                    return Err("PP exceeds move maximum".into());
                                }
                                slot.pp = remaining;
                            }
                        }
                        if let Some(t) = p.active_turns {
                            m.active_turns = t;
                        }
                    }
                    b.sides[s].pokemon_left = b.sides[s].mons.iter().filter(|m| !m.fainted).count();
                    b.sides[s].total_fainted = (teams[s].len() - b.sides[s].pokemon_left) as u8;
                    let side = &b.sides[s];
                    let (leads, reserves) = side.mons.split_at(side.n_active.min(side.mons.len()));
                    if leads.iter().any(|m| m.fainted) && reserves.iter().any(|m| !m.fainted) {
                        return Err("Choose living leads when reserves are available, or replay into a forced replacement".into());
                    }
                }
            }
            b
        };
        b.log_enabled = false;
        b.log.clear();
        if let Some(f) = &self.field {
            b.field.weather = f
                .weather
                .as_ref()
                .map(|w| Weather::from_id(w).ok_or_else(|| format!("unknown weather {w}")))
                .transpose()?;
            b.field.weather_turns = f.weather_turns;
            b.field.terrain = f
                .terrain
                .as_ref()
                .map(|t| Terrain::from_id(t).ok_or_else(|| format!("unknown terrain {t}")))
                .transpose()?;
            b.field.terrain_turns = f.terrain_turns;
            b.field.trick_room = f.trick_room;
        }
        if let Some(sides) = &self.side_conditions {
            for (side, c) in b.sides.iter_mut().zip(sides) {
                side.conds.tailwind = c.tailwind;
                side.conds.reflect = c.reflect;
                side.conds.light_screen = c.light_screen;
                side.conds.aurora_veil = c.aurora_veil;
            }
        }
        if let Some(t) = self.turn {
            if t == 0 {
                return Err("turn must be at least 1".into());
            }
            b.turn = t;
        }
        // Reject dead-side roots explicitly rather than manufacture a pending decision.
        validate_boundary(&b)?;
        for choices in &self.replay {
            if b.ended {
                return Err("replay continues past battle end".into());
            }
            let needed = [b.side_needs_choice(0), b.side_needs_choice(1)];
            for (s, choice) in choices.iter().enumerate() {
                if needed[s] {
                    b.choose(s, choice)?;
                } else if !choice.is_empty() {
                    return Err(
                        "use an empty replay choice for a side with no pending request".into(),
                    );
                }
            }
        }
        validate_boundary(&b)?;
        Ok(b)
    }
}

fn validate_set(mon: &MonSet) -> Result<()> {
    let dex = data::dex();
    let sp = dex.species(mon.species);
    if sp.battle_only {
        return Err("team sets must use base species".into());
    }
    if mon.points.iter().any(|&p| p > 32)
        || mon.points.iter().map(|&p| u32::from(p)).sum::<u32>() > 66
    {
        return Err(
            "invalid Champions points (32 per stat, 66 total); do not supply main-series EVs"
                .into(),
        );
    }
    if mon.moves.is_empty() || mon.moves.len() > 4 {
        return Err("each Pokémon requires 1–4 moves".into());
    }
    let learnset = &data::format_data()["learnsets"][&sp.id];
    for (i, &m) in mon.moves.iter().enumerate() {
        let mv = dex.mv(m);
        if mon.moves[..i].contains(&m) {
            return Err("duplicate move".into());
        }
        if !learnset
            .as_array()
            .is_some_and(|ls| ls.iter().any(|v| v.as_str() == Some(&mv.id)))
        {
            return Err(format!(
                "{} cannot learn {} in the pinned format",
                sp.name, mv.name
            ));
        }
    }
    if !sp
        .abilities
        .iter()
        .any(|(_, a)| data::id(a) == dex.ability(mon.ability).id)
    {
        return Err(format!("invalid ability for {}", sp.name));
    }
    if ninjask::dex::team::nature_name(&mon.nature).is_empty() {
        return Err("invalid nature".into());
    }
    Ok(())
}

fn validate_projection(p: &Value) -> Result<()> {
    if p["requestState"] != "move" || p["ended"] == true || p["queueLength"] != 0 {
        return Err("projection must be a nonterminal move boundary with queueLength=0".into());
    }
    let sides = p["sides"]
        .as_array()
        .filter(|s| s.len() == 2)
        .ok_or("projection requires exactly two sides")?;
    for side in sides {
        let mons = side["pokemon"]
            .as_array()
            .filter(|m| !m.is_empty() && m.len() <= 2)
            .ok_or("projection sides require 1–2 Pokémon")?;
        let alive = mons
            .iter()
            .filter(|m| m["hp"].as_u64().is_some_and(|v| v > 0))
            .count();
        if side["pokemonLeft"].as_u64() != Some(alive as u64) {
            return Err("projection pokemonLeft must match living Pokémon".into());
        }
        for m in mons {
            let hp = m["hp"].as_u64().ok_or("missing HP")?;
            if m["fainted"].as_bool() != Some(hp == 0) {
                return Err("projection fainted flag disagrees with HP".into());
            }
            for stat in ["atk", "def", "spa", "spd", "spe"] {
                if !m["storedStats"][stat]
                    .as_u64()
                    .is_some_and(|v| v > 0 && v <= 65535)
                {
                    return Err("storedStats must be positive u16 values".into());
                }
            }
            let moves = m["moves"].as_array().ok_or("missing moves")?;
            if moves.is_empty() || moves.len() > 4 {
                return Err("projection requires 1–4 moves".into());
            }
            let dex = data::dex();
            for key in ["ability", "baseAbility"] {
                let name = m[key]
                    .as_str()
                    .ok_or("projection requires ability and baseAbility")?;
                let ability = dex
                    .ability_id(name)
                    .ok_or_else(|| format!("unknown projection ability {name}"))?;
                if matches!(
                    support::ability_support(&dex, ability),
                    ninjask::dex::types::Support::Unsupported(_)
                ) {
                    return Err(format!("unsupported projection ability {name}"));
                }
            }
            if let Some(item) = m["item"].as_str().filter(|s| !s.is_empty()) {
                let id = dex
                    .item_id(item)
                    .ok_or_else(|| format!("unknown projection item {item}"))?;
                if matches!(
                    support::item_support(&dex, Some(id)),
                    ninjask::dex::types::Support::Unsupported(_)
                ) {
                    return Err("unsupported projection item".into());
                }
            }
            for mv in moves {
                let name = mv["id"].as_str().ok_or("projection move missing id")?;
                let id = dex
                    .move_id(name)
                    .ok_or_else(|| format!("unknown projection move {name}"))?;
                if matches!(
                    support::move_support(&dex, dex.mv(id)),
                    ninjask::dex::types::Support::Unsupported(_)
                ) {
                    return Err("unsupported projection move".into());
                }
                let max = mv["maxpp"]
                    .as_u64()
                    .filter(|&p| p > 0 && p <= 255)
                    .ok_or("invalid projection maxpp")?;
                if !mv["pp"].as_u64().is_some_and(|p| p <= max) {
                    return Err("invalid projection PP".into());
                }
            }
            if let Some(boosts) = m["boosts"].as_object()
                && boosts
                    .values()
                    .any(|v| !v.as_i64().is_some_and(|v| (-6..=6).contains(&v)))
            {
                return Err("projection boosts must be -6..6".into());
            }
            if !m["status"].is_null()
                && !m["status"]
                    .as_str()
                    .is_some_and(|s| Status::from_id(s).is_some())
            {
                return Err("invalid projection status".into());
            }
            let types = m["types"]
                .as_array()
                .filter(|ts| !ts.is_empty() && ts.len() <= 3)
                .ok_or("invalid projection types")?;
            if types
                .iter()
                .any(|t| !t.as_str().is_some_and(|t| dex.type_id(t).is_some()))
            {
                return Err("unknown projection type".into());
            }
        }
    }
    Ok(())
}

pub fn validate_boundary(b: &Battle) -> Result<()> {
    if b.ended || b.sides.iter().any(|s| s.pokemon_left == 0) {
        return Err("position is terminal; supply a nonterminal decision".into());
    }
    if !matches!(b.request, RequestState::Move | RequestState::Switch)
        || (b.request == RequestState::Move && !b.queue.is_empty())
        || b.sides.iter().any(|s| s.choice.is_some())
        || !(b.side_needs_choice(0) || b.side_needs_choice(1))
    {
        return Err("expected a move or replacement decision with no submitted choices".into());
    }
    Ok(())
}
