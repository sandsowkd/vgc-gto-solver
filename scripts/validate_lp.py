#!/usr/bin/env python3
"""Independent SciPy/HiGHS validation; production Rust has no LP dependency."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
import numpy as np
from scipy.optimize import linprog
import scipy

parser = argparse.ArgumentParser()
parser.add_argument('--binary', default='target/release/nashdex')
parser.add_argument('--games', type=int, default=64)
parser.add_argument('--output', default='benchmarks/lp-validation.json')
args = parser.parse_args()
if args.games <= 0: parser.error('--games must be positive')
rng = np.random.default_rng(20261124)
records = []
with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / 'matrix.json'
    for k in range(args.games):
        m, n = rng.integers(1, 10, size=2).tolist()
        a = rng.uniform(-1.0, 2.0, (m, n))
        # Maximize v, A^T x >= v, sum(x)=1, x>=0; v is unbounded.
        lp = linprog(np.r_[np.zeros(m), -1.0], A_ub=np.c_[-a.T, np.ones(n)],
                     b_ub=np.zeros(n), A_eq=[np.r_[np.ones(m), 0.0]], b_eq=[1.0],
                     bounds=[(0, None)] * m + [(None, None)], method='highs')
        assert lp.success, lp.message
        path.write_text(json.dumps(a.tolist()))
        for algorithm in ('regret-matching', 'regret-matching-plus'):
            s = json.loads(subprocess.check_output([args.binary, 'matrix', str(path),
                '--iterations', '250000', '--tolerance', '0.001', '--algorithm', algorithm]))
            value = -lp.fun
            assert s['lower_value'] - 1e-8 <= value <= s['upper_value'] + 1e-8
            assert s['nash_gap'] < 0.025, (k, algorithm, s['nash_gap'])
            records.append(dict(game=k, shape=[m, n], algorithm=algorithm, lp_value=value,
                estimated_value=s['value'], absolute_value_error=abs(s['value']-value),
                nash_gap=s['nash_gap'], iterations=s['iterations']))
result = dict(seed=20261124, scipy=scipy.__version__, numpy=np.__version__,
    independent_games=args.games, comparisons=len(records),
    max_value_error=max(r['absolute_value_error'] for r in records),
    max_nash_gap=max(r['nash_gap'] for r in records), records=records)
Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k:v for k,v in result.items() if k != 'records'}, indent=2))
