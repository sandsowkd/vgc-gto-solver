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


def solve(binary, fixture, samples, seed, policy, threads, timeout, budget_ms=None):
    command = [str(binary), "solve", str(fixture), "--samples", str(samples), "--seed", str(seed),
               "--policy", policy, "--threads", str(threads), "--json"]
    if budget_ms is not None:
        command.extend(("--budget-ms", str(budget_ms)))
    start = time.perf_counter()
    run = json.loads(subprocess.check_output(command, cwd=ROOT, timeout=timeout))
    run["elapsed_ms"] = (time.perf_counter() - start) * 1000
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


def value_and_responses(matrix, x, y):
    row_values = [sum(p * payoff for p, payoff in zip(y, row, strict=True)) for row in matrix]
    col_values = [sum(p * payoff for p, payoff in zip(x, col, strict=True)) for col in zip(*matrix)]
    return sum(p * value for p, value in zip(x, row_values, strict=True)), max(row_values), min(col_values)


def score(candidate, reference, target):
    if candidate["solution"] is None or reference["matrix"]["payoff"] is None:
        return {"status": "unresolved", "meets_target": False}
    for field in ("format", "simulator_commit", "showdown_commit"):
        require(candidate[field] == reference[field], f"Candidate and reference differ on {field}")
    x, y = (align(candidate, reference, side) for side in range(2))
    matrix = reference["matrix"]
    value, upper, lower = value_and_responses(matrix["payoff"], x, y)
    lo = [[cell["utility_interval"][0] for cell in row] for row in matrix["cells"]]
    hi = [[cell["utility_interval"][1] for cell in row] for row in matrix["cells"]]
    value_lo, upper_lo, lower_lo = value_and_responses(lo, x, y)
    value_hi, upper_hi, lower_hi = value_and_responses(hi, x, y)
    gap_lo, gap_hi = max(0, upper_lo - lower_hi), min(1, upper_hi - lower_lo)
    return {"status": "scored", "utility": value, "utility_interval": [value_lo, value_hi],
            "player1_deviation_gain": upper - value, "player2_deviation_gain": value - lower,
            "gap": upper - lower, "gap_interval": [gap_lo, gap_hi], "meets_target": gap_hi <= target}


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
    binary = args.binary.resolve()
    evaluator = args.reference_binary.resolve() if args.reference_binary else binary
    paths = [p.resolve() for p in args.fixture] if args.fixture else [ROOT / p for p in FIXTURES]
    report = {"schema_version": 1, "status": "in_progress", "created_utc": datetime.now(timezone.utc).isoformat(),
              "platform": platform.platform(), "profile": args.profile, "gap_target": args.gap_target,
              "candidate_binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
              "reference_binary_sha256": hashlib.sha256(evaluator.read_bytes()).hexdigest(), "fixtures": []}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.touch(exist_ok=False)
    save_report(output, report)
    for fixture in paths:
        ref = solve(evaluator, fixture, reference_samples, REFERENCE_SEED,
                    args.reference_policy, args.threads, args.timeout)
        entry = {"fixture": str(fixture), "sha256": hashlib.sha256(fixture.read_bytes()).hexdigest(),
                 "reference": summarize(ref), "candidates": []}
        report["fixtures"].append(entry)
        save_report(output, report)
        for seed in seeds:
            candidate = solve(binary, fixture, samples, seed, args.policy, args.threads, args.timeout, args.budget_ms)
            metrics = score(candidate, ref, args.gap_target)
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
