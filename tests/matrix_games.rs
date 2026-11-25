use nashdex::solver::{self, Algorithm, SolverConfig};

fn check(a: &[Vec<f64>], value: f64, x: Option<&[f64]>, y: Option<&[f64]>) {
    for algorithm in [Algorithm::RegretMatching, Algorithm::RegretMatchingPlus] {
        let s = solver::solve(
            a,
            &SolverConfig {
                iterations: 150_000,
                tolerance: 0.002,
                algorithm,
            },
        )
        .unwrap();
        assert!(s.nash_gap < 0.008, "{s:?}");
        assert!((s.value - value).abs() < 0.006, "{s:?}");
        for p in [&s.player1, &s.player2] {
            assert!((p.iter().sum::<f64>() - 1.0).abs() < 1e-10);
            assert!(p.iter().all(|&v| v >= 0.0 && v.is_finite()));
        }
        for (found, want) in [(&s.player1, x), (&s.player2, y)] {
            if let Some(w) = want {
                for (p, q) in found.iter().zip(w) {
                    assert!((p - q).abs() < 0.02, "{s:?}");
                }
            }
        }
    }
}
#[test]
fn matching_pennies() {
    check(
        &[vec![1.0, 0.0], vec![0.0, 1.0]],
        0.5,
        Some(&[0.5, 0.5]),
        Some(&[0.5, 0.5]),
    );
}
#[test]
fn rock_paper_scissors() {
    check(
        &[
            vec![0.5, 0.0, 1.0],
            vec![1.0, 0.5, 0.0],
            vec![0.0, 1.0, 0.5],
        ],
        0.5,
        Some(&[1.0 / 3.0; 3]),
        Some(&[1.0 / 3.0; 3]),
    );
}
#[test]
fn pure_saddle_and_dominated_row() {
    check(
        &[vec![0.8, 0.9], vec![0.1, 0.4], vec![0.2, 0.3]],
        0.8,
        Some(&[1.0, 0.0, 0.0]),
        Some(&[1.0, 0.0]),
    );
}
#[test]
fn nonuniform_equilibrium() {
    check(
        &[vec![1.0, 0.0], vec![0.0, 0.5]],
        1.0 / 3.0,
        Some(&[1.0 / 3.0, 2.0 / 3.0]),
        Some(&[1.0 / 3.0, 2.0 / 3.0]),
    );
}
#[test]
fn rectangular_asymmetric() {
    check(
        &[vec![1.0, 0.0, 0.4], vec![0.0, 0.5, 0.4]],
        1.0 / 3.0,
        Some(&[1.0 / 3.0, 2.0 / 3.0]),
        Some(&[1.0 / 3.0, 2.0 / 3.0, 0.0]),
    );
}
#[test]
fn affine_payoffs_and_single_action() {
    check(&[vec![-1.0, 3.0]], -1.0, Some(&[1.0]), Some(&[1.0, 0.0]));
}
#[test]
fn invalid_games_rejected() {
    for a in [
        vec![],
        vec![vec![]],
        vec![vec![1.0], vec![1.0, 2.0]],
        vec![vec![f64::NAN]],
        vec![vec![f64::INFINITY]],
    ] {
        assert!(solver::solve(&a, &SolverConfig::default()).is_err());
    }
    assert!(
        solver::solve(
            &[vec![0.0]],
            &SolverConfig {
                iterations: 0,
                ..Default::default()
            }
        )
        .is_err()
    );
}
#[test]
fn transpose_complement_preserves_value() {
    let a = vec![vec![0.1, 0.7, 0.8], vec![0.6, 0.2, 0.4]];
    let b: Vec<Vec<_>> = (0..3)
        .map(|j| (0..2).map(|i| 1.0 - a[i][j]).collect())
        .collect();
    let c = SolverConfig {
        iterations: 100_000,
        tolerance: 0.0001,
        ..Default::default()
    };
    let s = solver::solve(&a, &c).unwrap();
    let t = solver::solve(&b, &c).unwrap();
    assert!((s.value + t.value - 1.0).abs() < 0.001);
}
