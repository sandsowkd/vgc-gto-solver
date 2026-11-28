#!/usr/bin/env python3
"""Score candidate root strategies on an independently sampled reference matrix."""

import argparse
import hashlib
import json
import math
import os
import platform
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ("examples/endgame.json", "examples/doubles.json", "examples/held-out.json")
PROFILES = {"quick": (8, 64, (11, 29)), "deep": (32, 256, (11, 29, 47))}
REFERENCE_SEED = 810271


def binary_digest(binary):
    return hashlib.sha256(binary.read_bytes()).hexdigest()


def solve(binary, digest, fixture, samples, seed, policy, threads, timeout, budget_ms=None):
    command = [str(binary), "solve", str(fixture), "--samples", str(samples), "--seed", str(seed),
               "--policy", policy, "--threads", str(threads), "--json"]
    if budget_ms is not None:
        command.extend(("--budget-ms", str(budget_ms)))
    require(binary_digest(binary) == digest, f"Solver executable changed during evaluation: {binary}")
    start = time.perf_counter()
    run = json.loads(subprocess.check_output(command, cwd=ROOT, timeout=timeout))
    run["elapsed_ms"] = (time.perf_counter() - start) * 1000
    require(binary_digest(binary) == digest, f"Solver executable changed during evaluation: {binary}")
    validate(run, samples)
    return run


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(run, requested_samples):
    matrix = run["matrix"]
    cells = matrix["cells"]
    rows, cols = (len(side) for side in run["actions"])
    require(rows > 0 and cols > 0 and (rows, cols) == (matrix["rows"], matrix["columns"]),
            "Invalid action or matrix size")
    require(len(cells) == rows and all(len(row) == cols for row in cells), "Invalid cell layout")
    all_cells = [cell for row in cells for cell in row]
    for cell in all_cells:
        resolved = cell["wins"] + cell["losses"] + cell["draws"]
        samples = cell["samples"]
        require(0 <= samples <= requested_samples and resolved + cell["truncated"] == samples,
                "Outcome counts do not match sample count")
        lo, hi = cell["utility_interval"]
        require(0 <= lo <= hi <= 1, "Invalid utility interval")
        mean = cell["mean"]
        if samples == 0 or cell["truncated"]:
            require(mean is None, "Missing or censored cell has a point estimate")
        else:
            expected = (cell["wins"] + 0.5 * cell["draws"]) / samples
            require(mean is not None and math.isclose(mean, expected, abs_tol=1e-12),
                    "Cell utility differs from terminal win/draw/loss counts")
    complete = all(cell["samples"] > 0 for cell in all_cells)
    require(matrix["coverage_complete"] == complete, "Invalid coverage flag")
    require(matrix["requested_samples_complete"] == all(cell["samples"] == requested_samples for cell in all_cells),
            "Invalid fixed-work completion flag")
    require(matrix["samples"] == sum(cell["samples"] for cell in all_cells), "Invalid sample total")
    truncations = sum(cell["truncated"] for cell in all_cells)
    require(matrix["truncations"] == truncations, "Invalid truncation total")
    if not complete or truncations:
        require(run["solution"] is None and matrix["payoff"] is None,
                "Incomplete or censored matrix produced a point solution")
        return
    require(matrix["payoff"] == [[cell["mean"] for cell in row] for row in cells],
            "Payoff matrix disagrees with cell utilities")
    solution = run["solution"]
    require(solution is not None, "Complete matrix has no solution")
    for strategy, size in ((solution["player1"], rows), (solution["player2"], cols)):
        require(len(strategy) == size and all(0 <= p <= 1 for p in strategy)
                and math.isclose(sum(strategy), 1, abs_tol=1e-9), "Invalid strategy distribution")
    value, upper, lower = value_and_responses(matrix["payoff"], solution["player1"], solution["player2"])
    require(math.isclose(solution["value"], value, abs_tol=1e-9)
            and math.isclose(solution["nash_gap"], upper - lower, abs_tol=1e-9),
            "Reported utility or Nash gap disagrees with independent calculation")


def align(candidate, reference, side):
    actions = [action["choice"] for action in candidate["actions"][side]]
    keys = [action["choice"] for action in reference["actions"][side]]
    require(len(set(actions)) == len(actions) and len(set(keys)) == len(keys),
            "Canonical action names are not unique")
    require(set(actions) == set(keys), "Legal actions differ from the full reference action set")
    strategy = dict(zip(actions, candidate["solution"][f"player{side + 1}"], strict=True))
    return [strategy[key] for key in keys]


def action_values(matrix, x, y):
    row_values = [sum(p * payoff for p, payoff in zip(y, row, strict=True)) for row in matrix]
    col_values = [sum(p * payoff for p, payoff in zip(x, col, strict=True)) for col in zip(*matrix)]
    return row_values, col_values


def value_and_responses(matrix, x, y):
    row_values, col_values = action_values(matrix, x, y)
    return sum(p * value for p, value in zip(x, row_values, strict=True)), max(row_values), min(col_values)


def weighted_interval(mean, squared_weight, concentration):
    radius = math.sqrt(concentration * squared_weight)
    return max(0, mean - radius), min(1, mean + radius)


def response_bounds(cells, x, y, row_values, col_values, value, concentration):
    # Each cell mean is an average of independent bounded rollout outcomes.
    # An individual sample in cell i,j has weight prob(j) / n_ij for a row,
    # prob(i) / n_ij for a column, or prob(i) * prob(j) / n_ij for mix utility.
    row_weights = [sum(p * p / cell["samples"] for p, cell in zip(y, row, strict=True)) for row in cells]
    col_weights = [sum(p * p / cell["samples"] for p, cell in zip(x, col, strict=True)) for col in zip(*cells)]
    rows = [weighted_interval(v, w, concentration) for v, w in zip(row_values, row_weights, strict=True)]
    cols = [weighted_interval(v, w, concentration) for v, w in zip(col_values, col_weights, strict=True)]
    value_weight = sum(p * p * w for p, w in zip(x, row_weights, strict=True))
    mix = weighted_interval(value, value_weight, concentration)
    best_p1 = [max(row[k] for row in rows) for k in range(2)]
    best_p2 = [min(col[k] for col in cols) for k in range(2)]
    return mix, best_p1, best_p2


def interval_difference(a, b):
    return [max(0, a[0] - b[1]), min(1, a[1] - b[0])]


def score(candidate, reference, target, comparisons):
    if candidate["solution"] is None or reference["matrix"]["payoff"] is None:
        return {"status": "unresolved", "meets_target": False}
    for field in ("format", "simulator_commit", "showdown_commit"):
        require(candidate[field] == reference[field], f"Candidate and reference differ on {field}")
    x, y = (align(candidate, reference, side) for side in range(2))
    matrix = reference["matrix"]
    require(matrix["requested_samples_complete"], "Weighted intervals require an independent fixed-work reference")
    row_values, col_values = action_values(matrix["payoff"], x, y)
    value = sum(p * v for p, v in zip(x, row_values, strict=True))
    best_row = max(range(len(x)), key=row_values.__getitem__)
    best_col = min(range(len(y)), key=col_values.__getitem__)
    upper, lower = row_values[best_row], col_values[best_col]
    tests = (len(x) + len(y) + 1) * comparisons
    concentration = math.log(2 * tests / (1 - matrix["confidence"])) / 2
    mix, upper_band, lower_band = response_bounds(matrix["cells"], x, y, row_values, col_values, value, concentration)
    gap_band = interval_difference(upper_band, lower_band)

    # Keep the previous method for direct comparisons on the same samples.
    lo = [[cell["utility_interval"][0] for cell in row] for row in matrix["cells"]]
    hi = [[cell["utility_interval"][1] for cell in row] for row in matrix["cells"]]
    _, upper_lo, lower_lo = value_and_responses(lo, x, y)
    _, upper_hi, lower_hi = value_and_responses(hi, x, y)
    return {"status": "scored", "utility": value, "utility_interval": mix,
            "player1_best_response": reference["actions"][0][best_row]["choice"],
            "player2_best_response": reference["actions"][1][best_col]["choice"],
            "player1_deviation_gain": upper - value, "player2_deviation_gain": value - lower,
            "player1_deviation_interval": interval_difference(upper_band, mix),
            "player2_deviation_interval": interval_difference(mix, lower_band),
            "gap": upper - lower, "gap_interval": gap_band,
            "cellwise_gap_interval": interval_difference([upper_lo, upper_hi], [lower_lo, lower_hi]),
            "meets_target": gap_band[1] <= target}


def summarize(run):
    matrix, solution = run["matrix"], run["solution"]
    result = {"actions": run["actions"], "cells": matrix["cells"], "solution": solution}
    result_digest = hashlib.sha256(json.dumps(result, sort_keys=True, allow_nan=False).encode()).hexdigest()
    return {"config": run["config"], "simulator_commit": run["simulator_commit"],
            "showdown_commit": run["showdown_commit"], "format": run["format"],
            "shape": [matrix["rows"], matrix["columns"]], "samples": matrix["samples"],
            "coverage_complete": matrix["coverage_complete"], "truncations": matrix["truncations"],
            "requested_samples_complete": matrix["requested_samples_complete"],
            "cancelled_for_budget": matrix["cancelled_for_budget"],
            "elapsed_ms": run["elapsed_ms"], "runtime": run["runtime"],
            "matrix_gap": solution["nash_gap"] if solution else None, "result_sha256": result_digest}


def positive_int(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def save_report(output, report):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent, delete=False) as file:
        checkpoint = Path(file.name)
        try:
            json.dump(report, file, indent=2, allow_nan=False)
            file.write("\n")
            file.close()
            checkpoint.replace(output)
        finally:
            checkpoint.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=PROFILES, default="quick")
    parser.add_argument("--binary", type=Path, default=ROOT / "target/release/vgc-gto-solver")
    parser.add_argument("--reference-binary", type=Path, help="Pinned evaluator; defaults to --binary")
    parser.add_argument("--fixture", type=Path, action="append", help="Position JSON; repeat to add fixtures")
    parser.add_argument("--samples", type=positive_int, help="Candidate samples per action pair")
    parser.add_argument("--reference-samples", type=positive_int, help="Reference samples per action pair")
    parser.add_argument("--reference-seed", type=int, default=REFERENCE_SEED,
                        help="Independent fixed-work seed; rotate for confirmatory runs")
    parser.add_argument("--policy", choices=("random", "greedy", "tactical"), default="greedy")
    parser.add_argument("--reference-policy", choices=("random", "greedy", "tactical"), default="greedy")
    parser.add_argument("--threads", type=positive_int, default=min(4, os.cpu_count() or 1))
    parser.add_argument("--budget-ms", type=positive_int, help="Optional wall-clock budget for each candidate solve")
    parser.add_argument("--timeout", type=positive_int, default=300, help="Wall-clock seconds per solve")
    parser.add_argument("--gap-target", type=float, default=0.05, help="Maximum upper reference gap bound")
    parser.add_argument("--output", type=Path, required=True, help="New JSON report path")
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        parser.error("--output must not already exist")
    if not 0 <= args.gap_target <= 1:
        parser.error("--gap-target must be in [0, 1]")
    samples, reference_samples, seeds = PROFILES[args.profile]
    samples = args.samples or samples
    reference_samples = args.reference_samples or reference_samples
    if reference_samples <= samples:
        parser.error("--reference-samples must exceed --samples")
    if args.reference_seed in seeds or not 0 <= args.reference_seed <= 2**64 - 1:
        parser.error("--reference-seed must be a u64 distinct from the candidate seeds")
    binary = args.binary.resolve()
    evaluator = args.reference_binary.resolve() if args.reference_binary else binary
    paths = [p.resolve() for p in args.fixture] if args.fixture else [ROOT / p for p in FIXTURES]
    comparisons = len(seeds) * len(paths)
    report = {"schema_version": 2, "status": "in_progress", "created_utc": datetime.now(timezone.utc).isoformat(),
              "platform": platform.platform(), "profile": args.profile, "gap_target": args.gap_target,
              "interval_method": "Fixed-work weighted Hoeffding with simultaneous coverage across the reported fixtures and candidate seeds",
              "candidate_binary_sha256": binary_digest(binary),
              "reference_binary_sha256": binary_digest(evaluator), "fixtures": []}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.touch(exist_ok=False)
    save_report(output, report)
    for fixture in paths:
        ref = solve(evaluator, report["reference_binary_sha256"], fixture, reference_samples, args.reference_seed,
                    args.reference_policy, args.threads, args.timeout)
        entry = {"fixture": str(fixture), "sha256": hashlib.sha256(fixture.read_bytes()).hexdigest(),
                 "reference": summarize(ref), "candidates": []}
        report["fixtures"].append(entry)
        save_report(output, report)
        for seed in seeds:
            candidate = solve(binary, report["candidate_binary_sha256"], fixture, samples, seed,
                              args.policy, args.threads, args.timeout, args.budget_ms)
            metrics = score(candidate, ref, args.gap_target, comparisons)
            entry["candidates"].append({"run": summarize(candidate), "reference_score": metrics})
            save_report(output, report)
            print(f"{fixture.name} seed {seed}: {json.dumps(metrics)}", flush=True)
    results = [item["reference_score"] for fixture in report["fixtures"] for item in fixture["candidates"]]
    report["status"] = "complete"
    report["correctness_checks"] = "passed"
    report["all_gap_targets_met"] = all(result["meets_target"] for result in results)
    save_report(output, report)
    print(f"Saved {output}")


if __name__ == "__main__":
    main()
