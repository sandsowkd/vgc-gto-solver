use tower::Layer;
use vercel_runtime::{Error, axum::VercelLayer};
use vgc_gto_solver::web::api_router;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let router = axum::Router::new().nest("/vgc", api_router(false)?);
    vercel_runtime::run(VercelLayer::new().layer(router)).await
}
