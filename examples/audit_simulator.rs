//! Run with `cargo run --release --example audit_simulator`.
use ninjask::dex::{support, types::Support};
use serde_json::json;
fn main() {
    let dex = vgc_gto_solver::data::dex();
    let data = vgc_gto_solver::data::format_data();
    let mut reports = serde_json::Map::new();
    for kind in ["moves", "items", "abilities"] {
        let mut total = 0;
        let mut unsupported = Vec::new();
        for entry in data[kind].as_array().unwrap() {
            let id = entry["id"].as_str().unwrap();
            total += 1;
            let s = match kind {
                "moves" => support::move_support(&dex, dex.mv(dex.move_id(id).unwrap())),
                "items" => support::item_support(&dex, dex.item_id(id)),
                _ => support::ability_support(&dex, dex.ability_id(id).unwrap()),
            };
            if let Support::Unsupported(reason) = s {
                unsupported.push(json!({"id":id,"reason":reason}));
            }
        }
        reports.insert(
            kind.into(),
            json!({"total":total,"supported":total-unsupported.len(),"unsupported":unsupported}),
        );
    }
    println!("{}",serde_json::to_string_pretty(&json!({"format":vgc_gto_solver::data::FORMAT,"simulator_commit":vgc_gto_solver::data::SIMULATOR_COMMIT,"support":reports})).unwrap());
}
