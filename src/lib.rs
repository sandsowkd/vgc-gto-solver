//! NashDex estimates a root matrix under fixed continuation policies.
//! Its equilibrium is not an equilibrium of the full extensive-form battle.
pub mod actions;
pub mod battle;
pub mod benchmark;
pub mod data;
pub mod matrix;
pub mod policy;
pub mod rollout;
pub mod search;
pub mod solver;

pub type Result<T> = std::result::Result<T, String>;
