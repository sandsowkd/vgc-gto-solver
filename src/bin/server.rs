#[tokio::main]
async fn main() {
    if let Err(e) = vgc_gto_solver::web::serve().await {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
