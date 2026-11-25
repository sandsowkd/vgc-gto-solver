use clap::{Parser, Subcommand};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use vgc_gto_solver::{
    battle::Position,
    policy::PolicyKind,
    search::SearchConfig,
    solver::{self, SolverConfig},
};

#[derive(Parser)]
#[command(
    name = "vgc-gto-solver",
    version,
    about = "Pokémon Champions root matrix research solver"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    /// Estimate terminal-utility payoffs and solve the simultaneous root game.
    Solve {
        input: PathBuf,
        #[arg(long)]
        config: Option<PathBuf>,
        #[arg(long)]
        samples: Option<u64>,
        #[arg(long)]
        threads: Option<usize>,
        #[arg(long)]
        seed: Option<u64>,
        #[arg(long)]
        policy: Option<PolicyKind>,
        #[arg(long)]
        max_turns: Option<u32>,
        #[arg(long)]
        budget_ms: Option<u64>,
        #[arg(long)]
        iterations: Option<u64>,
        #[arg(long)]
        json: bool,
    },
    /// Solve an arbitrary numeric matrix, independently of Pokémon.
    Matrix {
        input: PathBuf,
        #[arg(long, default_value_t = 50_000)]
        iterations: u64,
        #[arg(long, default_value_t = 0.001)]
        tolerance: f64,
        #[arg(long,value_enum,default_value_t=solver::Algorithm::RegretMatchingPlus)]
        algorithm: solver::Algorithm,
    },
    /// Inspect legal joint actions and export a decision-boundary projection.
    Inspect { input: PathBuf },
    /// Replay a fixed choice sequence, exporting states for differential validation.
    Trace { input: PathBuf },
    /// Run clone, enumeration, complete-game and matrix-solver measurements.
    Bench {
        input: PathBuf,
        #[arg(long, default_value_t = 10_000)]
        iterations: u64,
        #[arg(long, default_value_t = 200)]
        games: u64,
        #[arg(long,value_enum,default_value_t=PolicyKind::Random)]
        policy: PolicyKind,
    },
    /// Compare policies (including a solver that re-solves each turn), with both team assignments.
    Match {
        input: PathBuf,
        #[arg(long, value_enum)]
        a: vgc_gto_solver::benchmark::Agent,
        #[arg(long, value_enum)]
        b: vgc_gto_solver::benchmark::Agent,
        #[arg(long, default_value_t = 100)]
        pairs: u64,
        #[arg(long, default_value_t = 1)]
        seed: u64,
        #[arg(long, default_value_t = 8)]
        solver_samples: u64,
    },
}
fn read<T: serde::de::DeserializeOwned>(p: &Path) -> vgc_gto_solver::Result<T> {
    let text = std::fs::read_to_string(p).map_err(|e| format!("{}: {e}", p.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", p.display()))
}
fn output(v: &impl serde::Serialize) -> vgc_gto_solver::Result<()> {
    println!(
        "{}",
        serde_json::to_string_pretty(v).map_err(|e| e.to_string())?
    );
    Ok(())
}
fn run() -> vgc_gto_solver::Result<()> {
    match Cli::parse().command {
        Command::Solve {
            input,
            config,
            samples,
            threads,
            seed,
            policy,
            max_turns,
            budget_ms,
            iterations,
            json,
        } => {
            let p: Position = read(&input)?;
            let mut c: SearchConfig = config
                .as_ref()
                .map(|p| read(p))
                .transpose()?
                .unwrap_or_default();
            if let Some(x) = samples {
                c.sampling.samples_per_cell = x;
            }
            if let Some(x) = threads {
                c.sampling.threads = x;
            }
            if let Some(x) = seed {
                c.sampling.seed = x;
            }
            if let Some(x) = policy {
                c.sampling.policies = [x; 2];
            }
            if let Some(x) = max_turns {
                c.sampling.max_turns = x;
            }
            if let Some(x) = budget_ms {
                c.budget_ms = Some(x);
            }
            if let Some(x) = iterations {
                c.solver.iterations = x;
            }
            let r = vgc_gto_solver::search::solve(&p, &c)?;
            if json {
                output(&r)?;
            } else {
                println!(
                    "vgc-gto-solver — {} × {} legal joint actions; {} samples; {:.1} ms",
                    r.matrix.rows, r.matrix.columns, r.matrix.samples, r.runtime.total_ms
                );
                if let Some(s) = &r.solution {
                    println!(
                        "Estimated terminal utility {:.4}; matrix Nash gap {:.6}; {} iterations",
                        s.value, s.nash_gap, s.iterations
                    );
                    if let (Some([lo, hi]), Some(gap)) = (
                        r.strategy_utility_interval,
                        r.nash_gap_upper_confidence_bound,
                    ) {
                        println!(
                            "Simultaneous {:.0}% utility interval [{lo:.4}, {hi:.4}]; statistical gap upper bound {gap:.4}",
                            r.matrix.confidence * 100.0
                        );
                    }
                    for (side, strategy) in [&s.player1, &s.player2].iter().enumerate() {
                        println!("Player {}:", side + 1);
                        let mut order: Vec<usize> = (0..strategy.len()).collect();
                        order.sort_by(|&i, &j| strategy[j].total_cmp(&strategy[i]));
                        for i in order {
                            let ev = if side == 0 {
                                s.player1_action_values[i]
                            } else {
                                1.0 - s.player2_action_values_in_player1_utility[i]
                            };
                            println!(
                                "  {:7.3}% EV {:.4}  {}",
                                strategy[i] * 100.0,
                                ev,
                                r.actions[side][i].description.join("; ")
                            );
                        }
                    }
                } else {
                    println!("No strategy: root matrix is incomplete or has censored rollouts.");
                }
                println!(
                    "Truncations: {} ({:.2}%). Use --json for matrix, all frequencies, counts and intervals.",
                    r.matrix.truncations,
                    100.0 * r.matrix.truncation_rate
                );
                for w in r.warnings {
                    println!("Note: {w}");
                }
            }
            Ok(())
        }
        Command::Matrix {
            input,
            iterations,
            tolerance,
            algorithm,
        } => output(&solver::solve(
            &read::<Vec<Vec<f64>>>(&input)?,
            &SolverConfig {
                iterations,
                tolerance,
                algorithm,
            },
        )?),
        Command::Inspect { input } => {
            let b = read::<Position>(&input)?.build()?;
            output(
                &json!({"actions":[vgc_gto_solver::actions::describe(&b,0,&vgc_gto_solver::actions::legal(&b,0)),vgc_gto_solver::actions::describe(&b,1,&vgc_gto_solver::actions::legal(&b,1))],"projection":b.projection()}),
            )
        }
        Command::Trace { input } => {
            let mut p: Position = read(&input)?;
            let replay = std::mem::take(&mut p.replay);
            let mut b = p.build()?;
            let mut states: Vec<Value> = vec![b.projection()];
            for c in replay {
                let needed = [b.side_needs_choice(0), b.side_needs_choice(1)];
                for (side, choice) in c.iter().enumerate() {
                    if needed[side] {
                        b.choose(side, choice)?;
                        states.push(b.projection());
                    } else if !choice.is_empty() {
                        return Err("use an empty choice for a side with no pending request".into());
                    }
                }
            }
            output(&states)
        }
        Command::Bench {
            input,
            iterations,
            games,
            policy,
        } => output(&vgc_gto_solver::benchmark::micro(
            &read(&input)?,
            iterations,
            games,
            policy,
        )?),
        Command::Match {
            input,
            a,
            b,
            pairs,
            seed,
            solver_samples,
        } => output(&vgc_gto_solver::benchmark::matches(
            &read(&input)?,
            a,
            b,
            pairs,
            seed,
            solver_samples,
        )?),
    }
}
fn main() {
    if let Err(e) = run() {
        eprintln!("vgc-gto-solver: {e}");
        std::process::exit(1);
    }
}
