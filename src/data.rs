//! Pinned simulator and format data. No network is required at runtime.
use ninjask::Dex;
use std::sync::{Arc, OnceLock};

pub const SIMULATOR_COMMIT: &str = "8a59175f3915771285cd16fce5d7f788610ff242";
pub const SHOWDOWN_COMMIT: &str = "3a766f2cfb5e51c1e428cfe87d0dba91a8f01640";
pub const FORMAT: &str = "gen9championsvgc2026regmc";
pub const FORMAT_JSON: &str = include_str!("../data/gen9championsvgc2026regmc.json");

pub fn dex() -> Arc<Dex> {
    static DEX: OnceLock<Arc<Dex>> = OnceLock::new();
    DEX.get_or_init(|| {
        Arc::new(Dex::from_json(FORMAT_JSON).expect("bundled pinned format must load"))
    })
    .clone()
}

pub fn format_data() -> &'static serde_json::Value {
    static DATA: OnceLock<serde_json::Value> = OnceLock::new();
    DATA.get_or_init(|| serde_json::from_str(FORMAT_JSON).expect("bundled JSON"))
}

pub fn id(s: &str) -> String {
    s.chars()
        .filter(char::is_ascii_alphanumeric)
        .flat_map(char::to_lowercase)
        .collect()
}
