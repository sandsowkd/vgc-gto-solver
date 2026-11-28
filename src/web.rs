//! Local HTTP application: native jobs, bounded work and replay-based exploration.
use crate::{
    actions,
    battle::{Pokemon, Position},
    control::Control,
    data,
    search::{self, SearchConfig, SearchResult},
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use ninjask::{Battle, battle::log::Viewer, rng::Rng};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tower_http::services::{ServeDir, ServeFile};

type ApiResult<T> = Result<Json<T>, ApiError>;
pub struct ApiError(StatusCode, String);
impl From<String> for ApiError {
    fn from(s: String) -> Self {
        Self(StatusCode::UNPROCESSABLE_ENTITY, s)
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":{"message":self.1}}))).into_response()
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Step {
    pub choices: [String; 2],
    pub seed: u64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Board {
    pub position: Position,
    #[serde(default)]
    pub history: Vec<Step>,
}
impl Board {
    fn build(&self) -> crate::Result<Battle> {
        if self.history.len() > 80
            || !self.position.replay.is_empty()
            || self.position.projection.is_some()
            || self.position.packed_teams.is_some()
        {
            return Err("Web positions require explicit teams and at most 80 replay steps".into());
        }
        if let Some(teams) = &self.position.teams {
            let dex = data::dex();
            let species_key = |p: &Pokemon| {
                dex.species_id(&p.species)
                    .map(|i| data::id(&dex.species(i).base_species))
                    .unwrap_or_else(|| data::id(&p.species))
            };
            for team in teams {
                for (i, p) in team.iter().enumerate() {
                    if team[..i].iter().any(|q| species_key(q) == species_key(p)) {
                        return Err("Species Clause: duplicate species on a side".into());
                    }
                    if p.item.as_ref().is_some_and(|item| {
                        team[..i].iter().any(|q| {
                            q.item
                                .as_ref()
                                .is_some_and(|q| data::id(q) == data::id(item))
                        })
                    }) {
                        return Err("Item Clause: duplicate held item on a side".into());
                    }
                }
            }
        }
        let mut b = self.position.build()?;
        b.log_enabled = true;
        for step in &self.history {
            if b.ended {
                return Err("History continues after the battle ended".into());
            }
            apply_step(&mut b, step)?;
        }
        Ok(b)
    }
}
fn apply_step(b: &mut Battle, step: &Step) -> crate::Result<()> {
    let mut chosen = [vec![], vec![]];
    for (s, out) in chosen.iter_mut().enumerate() {
        if !b.side_needs_choice(s) {
            if !step.choices[s].is_empty() {
                return Err("Side has no pending choice".into());
            }
            continue;
        }
        *out = actions::legal(b, s)
            .into_iter()
            .find(|a| b.choice_string(a) == step.choices[s])
            .ok_or_else(|| format!("Player {} choice is no longer legal", s + 1))?;
    }
    b.rng = Rng::new(step.seed);
    actions::apply(b, chosen);
    Ok(())
}
fn view(b: &Battle) -> Value {
    let a = [actions::legal(b, 0), actions::legal(b, 1)];
    let mut state = b.projection();
    for (side, team) in b.sides.iter().enumerate() {
        for (index, mon) in team.mons.iter().enumerate() {
            state["sides"][side]["pokemon"][index]["roster_species"] =
                json!(b.dex.species(mon.set_species).name);
        }
    }
    json!({"state":state,"actions":[actions::describe(b,0,&a[0]),actions::describe(b,1,&a[1])],"needs_choice":[b.side_needs_choice(0),b.side_needs_choice(1)],"events":b.log.iter().map(|l|l.render(Viewer::Omniscient)).collect::<Vec<_>>(),"ended":b.ended,"winner":b.winner})
}
#[derive(Default)]
struct Job {
    control: Arc<Control>,
    result: Mutex<Option<crate::Result<SearchResult>>>,
    started: Option<Instant>,
}
#[derive(Clone)]
struct App {
    jobs: Arc<Mutex<HashMap<u64, Arc<Job>>>>,
    next: Arc<AtomicU64>,
    permits: Arc<tokio::sync::Semaphore>,
    catalog: Arc<Value>,
    threads: usize,
    client: reqwest::Client,
}
async fn origin_guard(req: Request<axum::body::Body>, next: Next) -> Response {
    if let Some(origin) = req.headers().get("origin").and_then(|h| h.to_str().ok()) {
        let host = req
            .headers()
            .get("host")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");
        let allowed = origin == format!("http://{host}")
            || origin == format!("https://{host}")
            || ["http://localhost:5173", "http://127.0.0.1:5173"].contains(&origin)
            || std::env::var("VGC_APP_ORIGIN").is_ok_and(|o| o == origin);
        if !allowed {
            return ApiError(StatusCode::FORBIDDEN, "Cross-origin request refused".into())
                .into_response();
        }
    }
    next.run(req).await
}
fn catalog() -> Value {
    let mut c: Value =
        serde_json::from_str(include_str!("../data/web-catalog.json")).expect("catalog snapshot");
    let dex = data::dex();
    use ninjask::dex::{support, types::Support};
    for (key, kind) in [("moves", 0), ("abilities", 1), ("items", 2)] {
        if let Some(entries) = c[key].as_array_mut() {
            entries.retain(|e| {
                let id = e["id"].as_str().unwrap_or("");
                match kind {
                    0 => dex.move_id(id).is_some_and(|i| {
                        !matches!(
                            support::move_support(&dex, dex.mv(i)),
                            Support::Unsupported(_)
                        )
                    }),
                    1 => dex.ability_id(id).is_some_and(|i| {
                        !matches!(support::ability_support(&dex, i), Support::Unsupported(_))
                    }),
                    _ => dex.item_id(id).is_some_and(|i| {
                        !matches!(
                            support::item_support(&dex, Some(i)),
                            Support::Unsupported(_)
                        )
                    }),
                }
            });
        }
    }
    for m in c["moves"].as_array_mut().expect("moves") {
        if let Some(i) = dex.move_id(m["id"].as_str().unwrap_or("")) {
            m["max_pp"] = json!(ninjask::dex::team::champions_max_pp(
                dex.mv(i).pp,
                dex.mv(i).no_pp_boosts
            ));
        }
    }
    for sp in c["species"].as_array_mut().expect("species") {
        if let Some(p) = sp["presets"].as_array_mut() {
            p.retain(|p| {
                serde_json::from_value::<Pokemon>(p["set"].clone())
                    .is_ok_and(|p| validate_mon(&p).is_ok())
            });
        }
    }
    c["limits"] = json!({"max_budget_ms":60000,"max_threads":std::thread::available_parallelism().map_or(1,usize::from).min(8),"max_pairs":65536});
    c
}
fn validate_mon(p: &Pokemon) -> crate::Result<[u16; 6]> {
    crate::battle::checked_set(p).map(|s| {
        let dex = data::dex();
        ninjask::dex::team::champions_stats(
            &dex.species(s.species).base_stats,
            &s.points,
            dex.nature(&s.nature),
        )
    })
}
async fn validate(Json(p): Json<Pokemon>) -> ApiResult<Value> {
    let stats = validate_mon(&p)?;
    if p.hp.is_some_and(|hp| hp > stats[0]) {
        return Err("Current HP exceeds maximum".to_string().into());
    }
    let dex = data::dex();
    if p.pp.as_ref().is_some_and(|pp| {
        pp.len() != p.moves.len()
            || pp.iter().zip(&p.moves).any(|(pp, m)| {
                dex.move_id(m).is_none_or(|id| {
                    *pp > ninjask::dex::team::champions_max_pp(
                        dex.mv(id).pp,
                        dex.mv(id).no_pp_boosts,
                    )
                })
            })
    }) {
        return Err("PP exceeds the move maximum".to_string().into());
    }
    Ok(Json(json!({"valid":true,"stats":stats})))
}
async fn inspect(Json(board): Json<Board>) -> ApiResult<Value> {
    let b = tokio::task::spawn_blocking(move || board.build())
        .await
        .map_err(|e| e.to_string())??;
    Ok(Json(view(&b)))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Advance {
    board: Board,
    step: Step,
}
async fn advance(Json(mut r): Json<Advance>) -> ApiResult<Value> {
    r.board.history.push(r.step);
    inspect(Json(r.board)).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Solve {
    board: Board,
    config: SearchConfig,
}
async fn solve(State(app): State<App>, Json(r): Json<Solve>) -> ApiResult<Value> {
    let mut c = r.config;
    if !(1..=60000).contains(&c.budget_ms.unwrap_or(0))
        || c.sampling.samples_per_cell == 0
        || c.sampling.samples_per_cell > 4096
        || !(1..=512).contains(&c.sampling.max_turns)
        || c.sampling.threads > app.threads
        || c.solver.iterations > 500000
    {
        return Err("Limits: budget 1–60000 ms, samples 1–4096, turns 1–512, iterations ≤500000; threads must respect server limit".to_string().into());
    }
    c.solver.validate()?;
    c.sampling.threads = if c.sampling.threads == 0 {
        app.threads.min(4)
    } else {
        c.sampling.threads
    };
    let permit = app.permits.clone().try_acquire_owned().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "A solve is already running. Cancel it or wait.".into(),
        )
    })?;
    let b = tokio::task::spawn_blocking(move || r.board.build())
        .await
        .map_err(|e| e.to_string())??;
    crate::battle::validate_boundary(&b)?;
    if actions::legal(&b, 0)
        .len()
        .saturating_mul(actions::legal(&b, 1).len())
        > 65536
    {
        return Err("This position exceeds the 65,536 action-pair limit"
            .to_string()
            .into());
    }
    let id = app.next.fetch_add(1, Ordering::Relaxed);
    let job = Arc::new(Job {
        started: Some(Instant::now()),
        ..Default::default()
    });
    {
        let mut jobs = app.jobs.lock().expect("jobs");
        jobs.retain(|_, j| {
            j.result.lock().expect("result").is_none()
                || j.started
                    .is_some_and(|t| t.elapsed() < Duration::from_secs(900))
        });
        if jobs.len() >= 16 {
            let oldest = jobs.keys().copied().min().unwrap();
            jobs.remove(&oldest);
        }
        jobs.insert(id, job.clone());
    }
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            search::solve_battle(&b, &c, Instant::now(), Some(&job.control))
        }))
        .unwrap_or_else(|_| Err("Simulator failed for this position".into()));
        job.control.phase.store(3, Ordering::Relaxed);
        *job.result.lock().expect("result") = Some(result);
    });
    Ok(Json(json!({"id":id})))
}
async fn job(State(app): State<App>, Path(id): Path<u64>) -> ApiResult<Value> {
    let j = app
        .jobs
        .lock()
        .expect("jobs")
        .get(&id)
        .cloned()
        .ok_or_else(|| {
            ApiError(
                StatusCode::NOT_FOUND,
                "Job expired or does not exist".into(),
            )
        })?;
    let result = j.result.lock().expect("result");
    Ok(Json(
        json!({"id":id,"elapsed_ms":j.started.map_or(0,|t|t.elapsed().as_millis()),"progress":j.control.snapshot(),"status":if j.control.cancelled.load(Ordering::Relaxed){"cancelled"}else if result.is_none(){"running"}else if result.as_ref().is_some_and(Result::is_ok){"complete"}else{"error"},"result":result.as_ref().and_then(|r|r.as_ref().ok()),"error":result.as_ref().and_then(|r|r.as_ref().err())}),
    ))
}
async fn cancel(State(app): State<App>, Path(id): Path<u64>) -> ApiResult<Value> {
    let j = app
        .jobs
        .lock()
        .expect("jobs")
        .get(&id)
        .cloned()
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "Unknown job".into()))?;
    j.control.cancelled.store(true, Ordering::Relaxed);
    Ok(Json(json!({"cancelled":true})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Paste {
    url: String,
}
pub fn paste_id(s: &str) -> crate::Result<String> {
    let url = reqwest::Url::parse(s).map_err(|_| "Invalid PokePaste URL")?;
    let id = url.path().trim_matches('/');
    if url.scheme() != "https"
        || url.host_str() != Some("pokepast.es")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || id.len() != 16
        || !id.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err("Use an https://pokepast.es/ URL with a 16-character paste ID".into());
    }
    Ok(id.into())
}
async fn paste(State(app): State<App>, Json(p): Json<Paste>) -> ApiResult<Value> {
    let id = paste_id(&p.url)?;
    let mut response = app
        .client
        .get(format!("https://pokepast.es/{id}/json"))
        .send()
        .await
        .map_err(|_| "PokePaste did not respond".to_string())?;
    if !response.status().is_success() {
        return Err("PokePaste returned an error or redirect".to_string().into());
    }
    let mut bytes = vec![];
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Paste download failed".to_string())?
    {
        if bytes.len() + chunk.len() > 524288 {
            return Err("Paste exceeds 512 KiB".to_string().into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let v: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid PokePaste response".to_string())?;
    let text = v["paste"]
        .as_str()
        .ok_or_else(|| "PokePaste has no team text".to_string())?;
    Ok(Json(
        json!({"text":text,"title":v["title"],"author":v["author"]}),
    ))
}
pub async fn serve() -> crate::Result<()> {
    let available = std::thread::available_parallelism()
        .map_or(1, usize::from)
        .min(8);
    let threads = std::env::var("VGC_THREADS")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(available)
        .clamp(1, available);
    let mut catalog_data = catalog();
    catalog_data["limits"]["max_threads"] = json!(threads);
    let app = App {
        jobs: Default::default(),
        next: Arc::new(AtomicU64::new(1)),
        permits: Arc::new(tokio::sync::Semaphore::new(1)),
        catalog: Arc::new(catalog_data),
        threads,
        client: reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(|e| e.to_string())?,
    };
    let router = Router::new()
        .route(
            "/api/health",
            get(|| async {
                Json(json!({"ok":true,"name":"vgc-gto-solver","format":data::FORMAT}))
            }),
        )
        .route(
            "/api/catalog",
            get(|State(a): State<App>| async move { Json((*a.catalog).clone()) }),
        )
        .route("/api/validate", post(validate))
        .route("/api/inspect", post(inspect))
        .route("/api/advance", post(advance))
        .route("/api/solve", post(solve))
        .route("/api/jobs/{id}", get(job))
        .route("/api/jobs/{id}/cancel", post(cancel))
        .route("/api/import", post(paste))
        .with_state(app)
        .layer(DefaultBodyLimit::max(1048576))
        .layer(middleware::from_fn(origin_guard))
        .fallback_service(
            ServeDir::new("web/dist").not_found_service(ServeFile::new("web/dist/index.html")),
        );
    let bind = std::env::var("VGC_BIND").unwrap_or_else(|_| "127.0.0.1:8787".into());
    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .map_err(|e| e.to_string())?;
    println!("vgc-gto-solver → http://{bind}");
    axum::serve(listener, router)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn board() -> Board {
        serde_json::from_value(json!({"position":{"teams":[[{"species":"Garchomp","ability":"Rough Skin","moves":["Dragon Claw","Protect"],"points":[0,32,0,0,2,32],"nature":"Jolly"}],[{"species":"Charizard","ability":"Blaze","item":"Charizardite Y","moves":["Air Slash","Protect"],"points":[0,0,0,32,2,32],"nature":"Timid"}]],"seed":1},"history":[]})).unwrap()
    }
    #[test]
    fn paste_fetch_only_accepts_canonical_pokepaste_ids() {
        assert_eq!(
            paste_id("https://pokepast.es/0123456789abcdef").unwrap(),
            "0123456789abcdef"
        );
        for s in [
            "http://pokepast.es/0123456789abcdef",
            "https://pokepast.es.evil/0123456789abcdef",
            "https://evil@pokepast.es/0123456789abcdef",
            "https://pokepast.es:8443/0123456789abcdef",
            "https://pokepast.es/../secrets",
            "https://127.0.0.1/0123456789abcdef",
            "https://pokepast.es/0123456789abcdef?url=x",
            "https://pokepast.es/0123456789abcdef#x",
        ] {
            assert!(paste_id(s).is_err(), "{s}");
        }
    }
    #[test]
    fn replay_preserves_seeded_events_mega_and_state() {
        let mut b = board();
        let before = b.build().unwrap().projection();
        let root = b.build().unwrap();
        let first = actions::legal(&root, 0)
            .into_iter()
            .find(|a| root.choice_string(a).starts_with("move 2"))
            .unwrap();
        let second = actions::legal(&root, 1)
            .into_iter()
            .find(|a| root.choice_string(a).contains("mega"))
            .unwrap();
        b.history.push(Step {
            choices: [root.choice_string(&first), root.choice_string(&second)],
            seed: 42,
        });
        let a = b.build().unwrap();
        let c = b.build().unwrap();
        assert_eq!(a.projection(), c.projection());
        assert_eq!(
            a.log
                .iter()
                .map(|l| l.render(Viewer::Omniscient))
                .collect::<Vec<_>>(),
            c.log
                .iter()
                .map(|l| l.render(Viewer::Omniscient))
                .collect::<Vec<_>>()
        );
        assert!(a.dex.species(a.sides[1].mons[0].species).is_mega);
        assert!(!a.log.is_empty());
        b.history.clear();
        assert_eq!(before, b.build().unwrap().projection());
    }
    #[test]
    fn four_on_four_replays_a_switch_and_a_knockout_replacement() {
        let mut b = Board {
            position: serde_json::from_str(include_str!("../examples/four-v-four.json")).unwrap(),
            history: Vec::new(),
        };
        let threatened = &mut b.position.teams.as_mut().unwrap()[0][1];
        threatened.hp = Some(1);
        threatened.item = None;
        let root = b.build().unwrap();
        let legal = actions::legal(&root, 0);
        assert!(
            legal
                .iter()
                .any(|a| root.choice_string(a) == "switch 3, switch 4")
        );
        assert!(
            !legal
                .iter()
                .any(|a| root.choice_string(a) == "switch 3, switch 3")
        );
        b.history.push(Step {
            choices: ["switch 3, move 1 1".into(), "move 4, move 1 2".into()],
            seed: 17,
        });
        let replacing = b.build().unwrap();
        let state = view(&replacing);
        assert_eq!(
            state["state"]["requestState"], "switch",
            "{}",
            state["events"]
        );
        assert_eq!(state["needs_choice"], json!([true, false]));
        assert_eq!(
            state["state"]["sides"][0]["pokemon"][0]["species"],
            "Charizard"
        );
        assert_eq!(
            state["state"]["sides"][0]["pokemon"][2]["roster_species"],
            "Garchomp"
        );
        assert_eq!(state["actions"][1][0]["choice"], "");
        let mut config = SearchConfig::default();
        config.sampling.samples_per_cell = 1;
        let solved = search::solve_battle(&replacing, &config, Instant::now(), None).unwrap();
        assert_eq!((solved.matrix.rows, solved.matrix.columns), (2, 1));
        assert!(solved.solution.is_some());

        let step = Step {
            choices: ["pass, switch 4".into(), String::new()],
            seed: 42,
        };
        b.history.push(step.clone());
        let after = b.build().unwrap();
        assert_eq!(
            view(&after)["state"]["sides"][0]["pokemon"][1]["species"],
            "Clefable"
        );
        b.history.pop();
        assert_eq!(view(&b.build().unwrap()), state);
        b.history.push(step);
        assert_eq!(view(&b.build().unwrap()), view(&after));
    }
    #[test]
    fn replacement_after_pivot_resumes_the_queued_turn() {
        let mut b = Board {
            position: serde_json::from_str(include_str!("../examples/four-v-four.json")).unwrap(),
            history: Vec::new(),
        };
        b.position.teams.as_mut().unwrap()[0][1].moves[0] = "Volt Switch".into();
        b.history.push(Step {
            choices: ["move 4, move 1 1".into(), "move 1, move 4".into()],
            seed: 17,
        });
        let pivot = b.build().unwrap();
        assert_eq!(pivot.request, ninjask::state::RequestState::Switch);
        assert_eq!(pivot.turn, 1);
        assert!(!pivot.queue.is_empty());
        crate::battle::validate_boundary(&pivot).unwrap();
        b.history.push(Step {
            choices: ["pass, switch 4".into(), String::new()],
            seed: 42,
        });
        let after = b.build().unwrap();
        assert_eq!(after.turn, 2);
        assert_eq!(after.request, ninjask::state::RequestState::Move);
        assert!(
            after
                .log
                .iter()
                .any(|l| l.render(Viewer::Omniscient).contains("Rock Slide"))
        );
    }
    #[test]
    fn all_bundled_presets_validate_with_native_stats() {
        let c = catalog();
        let mut count = 0;
        for sp in c["species"].as_array().unwrap() {
            assert!(!sp["presets"].as_array().unwrap().is_empty(), "{sp}");
            for p in sp["presets"].as_array().unwrap() {
                let set: Pokemon = serde_json::from_value(p["set"].clone()).unwrap();
                assert!(validate_mon(&set).unwrap().iter().all(|n| *n > 0));
                count += 1;
            }
        }
        assert_eq!(count, 565);
    }
    #[test]
    fn cancellation_reaches_sampling_and_matrix_solver() {
        let control = Control::default();
        control.cancelled.store(true, Ordering::Relaxed);
        let b = board().build().unwrap();
        let mut config = SearchConfig::default();
        config.sampling.samples_per_cell = 1;
        assert!(
            search::solve_battle(&b, &config, Instant::now(), Some(&control))
                .unwrap_err()
                .contains("cancelled")
        );
        assert!(
            crate::solver::solve_controlled(
                &[vec![1.0, 0.0], vec![0.0, 1.0]],
                &Default::default(),
                None,
                Some(&control)
            )
            .is_err()
        );
    }
}
