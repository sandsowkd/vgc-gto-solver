#!/usr/bin/env python3
"""Reproducible work counts; latency measurements are machine dependent."""
import argparse
import copy
import datetime
from zoneinfo import ZoneInfo
import json
import platform
import os
from pathlib import Path
import subprocess
import tempfile
import time

parser=argparse.ArgumentParser()
parser.add_argument('--binary',default='target/release/vgc-gto-solver')
parser.add_argument('--output',default='benchmarks/results.json')
args=parser.parse_args()
def run(*command):return json.loads(subprocess.check_output([args.binary,*map(str,command)]))
def summary(r):
    m=r['matrix'];s=r['solution']
    return dict(runtime=r['runtime'],shape=[m['rows'],m['columns']],samples=m['samples'],
        min_samples=min(c['samples'] for row in m['cells'] for c in row),
        max_samples=max(c['samples'] for row in m['cells'] for c in row),
        coverage_complete=m['coverage_complete'],truncations=m['truncations'],
        equilibrium_utility=s['value'] if s else None,nash_gap=s['nash_gap'] if s else None,
        solver_iterations=s['iterations'] if s else None,
        utility_interval=r['strategy_utility_interval'],statistical_gap_bound=r['nash_gap_upper_confidence_bound'],
        strategies=[s['player1'],s['player2']] if s else None)

def sysctl(name, fallback):
    if platform.system()!='Darwin': return fallback
    return subprocess.check_output(['sysctl','-n',name],text=True).strip()
results=dict(machine=dict(platform=platform.platform(),processor=platform.processor(),
    cpu=sysctl('machdep.cpu.brand_string',platform.processor()),
    logical_cpus=int(sysctl('hw.ncpu',os.cpu_count() or 1)),
    memory_bytes=int(sysctl('hw.memsize',os.sysconf('SC_PHYS_PAGES')*os.sysconf('SC_PAGE_SIZE')))),
    date=datetime.datetime.now(ZoneInfo('America/Denver')).date().isoformat(),
    timestamp_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),simulator_commit='8a59175f3915771285cd16fce5d7f788610ff242',
    fixture_method='Authored legal Reg M-C sets covering common archetypes; illustrative, not a tournament-distribution sample.',
    micro=[],scaling=[],budgets=[],stability=[],matches=[])

for fixture in ['doubles','held-out']:
    for policy in ['random','greedy','tactical']:
        r=run('bench',f'examples/{fixture}.json','--iterations',100000,'--games',2000,'--policy',policy)
        results['micro'].append(dict(fixture=fixture,**r))
    print('micro:',fixture,flush=True)

for threads in [1,2,4,10]:
    r=run('solve','examples/doubles.json','--samples',4,'--threads',threads,'--json')
    results['scaling'].append(dict(threads=threads,**summary(r)))
print('scaling done',flush=True)

for budget in [100,500,1000,2000,5000,10000]:
    t=time.perf_counter()
    r=run('solve','examples/doubles.json','--samples',1000000,'--threads',10,'--budget-ms',budget,'--json')
    results['budgets'].append(dict(budget_ms=budget,subprocess_ms=(time.perf_counter()-t)*1000,**summary(r)))
    print('budget:',budget,flush=True)

for seed in [11,29,47]:
    r=run('solve','examples/doubles.json','--samples',32,'--threads',10,'--seed',seed,'--json')
    results['stability'].append(dict(seed=seed,**summary(r)))
print('stability done',flush=True)

with tempfile.TemporaryDirectory() as tmp:
    for fixture in ['doubles','held-out']:
        for a,b in [('greedy','random'),('tactical','random'),('tactical','greedy')]:
            r=run('match',f'examples/{fixture}.json','--a',a,'--b',b,'--pairs',200,'--seed',20261124)
            results['matches'].append(dict(fixture=fixture,held_out=fixture=='held-out',**r))
    # Solver is re-run every decision. Restricted endgames keep this validation tractable.
    base=json.loads(Path('examples/doubles.json').read_text())
    arena=[]
    for i in range(2):
        p=copy.deepcopy(base)
        p['teams']=[[p['teams'][0][i]],[p['teams'][1][i]]]
        for team in p['teams']:
            team[0]['moves']=[team[0]['moves'][0],'Protect']
            team[0]['hp']=60
        arena.append(p)
    # A distinct held-out matchup, no changes to policies after viewing its scores.
    p=json.loads(Path('examples/held-out.json').read_text())
    p['teams']=[[p['teams'][0][0]],[p['teams'][1][0]]]
    p['teams'][0][0]['moves']=['Crunch','Protect'];p['teams'][1][0]['moves']=['Moonblast','Protect']
    for team in p['teams']:team[0]['hp']=80
    arena.append(p)
    for fixture in ['doubles','held-out']:
        p=json.loads(Path(f'examples/{fixture}.json').read_text())
        for team in p['teams']:
            for mon in team:
                attack='Flare Blitz' if mon['species']=='Incineroar' else mon['moves'][0]
                mon['moves']=[attack,'Protect'];mon['hp']=80
        arena.append(p)
    results['solver_evaluation_positions']=arena
    for i,p in enumerate(arena):
        path=Path(tmp)/'endgame.json';path.write_text(json.dumps(p))
        for opponent in ['random','greedy','tactical']:
            r=run('match',path,'--a','solver','--b',opponent,'--pairs',50 if i<3 else 25,'--seed',20261124,'--solver-samples',16 if i<3 else 8)
            results['matches'].append(dict(fixture=f'endgame-{i}' if i<3 else f'reduced-doubles-{i-3}',held_out=i in (2,4),**r))
        print('solver evaluation:',i,flush=True)

Path(args.output).write_text(json.dumps(results,indent=2)+'\n')
print('Saved',args.output,flush=True)
