#!/usr/bin/env python3
"""Replay identical seeded choices; compare full projections after each input."""
import argparse
import copy
import json
import os
from pathlib import Path
import random
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--binary', default='target/release/nashdex')
parser.add_argument('--engine', default='.cache/reference/ninjask')
parser.add_argument('--showdown', default='.cache/reference/showdown')
parser.add_argument('--seeds', type=int, default=5)
parser.add_argument('--output', default='benchmarks/showdown-validation.json')
args = parser.parse_args()
if args.seeds <= 0: parser.error('--seeds must be positive')
engine = Path(args.engine).resolve()
for path,expected in [(engine,'8a59175f3915771285cd16fce5d7f788610ff242'),(Path(args.showdown),'3a766f2cfb5e51c1e428cfe87d0dba91a8f01640')]:
    actual=subprocess.check_output(['git','-C',str(path),'rev-parse','HEAD'],text=True).strip()
    assert actual==expected,(str(path),actual,expected)
env = dict(os.environ, NINJASK_SHOWDOWN=str(Path(args.showdown).resolve()))
server = subprocess.Popen(['node', str(engine/'refsim/server.js')], env=env,
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

def call(**message):
    server.stdin.write(json.dumps(message)+'\n'); server.stdin.flush()
    result = json.loads(server.stdout.readline())
    if 'error' in result: raise RuntimeError(result)
    result = result['result']
    result.pop('_requests', None)
    return result

def difference(a, b, path=''):
    if type(a) != type(b):
        if isinstance(a, (float,int)) and isinstance(b, (float,int)) and a == b: return None
        return (path,a,b)
    if isinstance(a,dict):
        for k in a.keys()|b.keys():
            if k not in a or k not in b: return(path+'/'+k,a.get(k),b.get(k))
            d=difference(a[k],b[k],path+'/'+k)
            if d:return d
    elif isinstance(a,list):
        if len(a)!=len(b):return(path+'/length',len(a),len(b))
        for i,(x,y) in enumerate(zip(a,b)):
            d=difference(x,y,path+f'/{i}')
            if d:return d
    elif a!=b:return(path,a,b)
    return None

def packed(team):
    return ']'.join('|'.join([p['species'],'',p.get('item',''),p['ability'],','.join(p['moves']),
        p.get('nature','Hardy'),','.join(map(str,p.get('points',[0]*6))),'','','','50','']) for p in team)

records=[]
try:
    with tempfile.TemporaryDirectory() as tmp:
        path=Path(tmp)/'position.json'
        fixtures=[json.loads(Path('examples/doubles.json').read_text()),json.loads(Path('examples/held-out.json').read_text())]
        # Mirror matchup deliberately exercises speed ties.
        mirror=copy.deepcopy(fixtures[0]);mirror['teams']=[copy.deepcopy(mirror['teams'][0]),copy.deepcopy(mirror['teams'][0])]
        fixtures.append(mirror)
        for f,position in enumerate(fixtures):
            for seed in range(args.seeds):
                p=copy.deepcopy(position);p['reference_seed']='sodium,'+f'{seed:064x}'
                p['replay']=[];identifier=f'{f}-{seed}'
                call(cmd='start', id=identifier, format='gen9championsvgc2026regmc',seed=p['reference_seed'],
                    p1=dict(name='p1',team=packed(p['teams'][0])),p2=dict(name='p2',team=packed(p['teams'][1])))
                for s in range(2):
                    call(cmd='choose',id=identifier,side=f'p{s+1}',choice='team '+''.join(str(i+1) for i in range(len(p['teams'][s]))))
                states=[call(cmd='state',id=identifier)]
                rng=random.Random(20261124+100*f+seed)
                for turn in range(30):
                    path.write_text(json.dumps(p))
                    inspected=json.loads(subprocess.check_output([args.binary,'inspect',str(path)]))
                    choices=[rng.choice(a)['choice'] for a in inspected['actions']]
                    p['replay'].append(choices)
                    for s,c in enumerate(choices):
                        reply=call(cmd='choose',id=identifier,side=f'p{s+1}',choice=c)
                        assert not any(reply.get('errors',{}).values()),reply
                        states.append(call(cmd='state',id=identifier))
                    if states[-1]['ended']:break
                path.write_text(json.dumps(p))
                actual=json.loads(subprocess.check_output([args.binary,'trace',str(path)]))
                d=difference(actual,states)
                assert d is None,(identifier,d)
                records.append(dict(fixture=f,seed=seed,turns=len(p['replay']),states=len(states),ended=states[-1]['ended']))
                call(cmd='close',id=identifier)
finally:
    server.terminate();server.wait()
result=dict(simulator_commit='8a59175f3915771285cd16fce5d7f788610ff242',showdown_commit='3a766f2cfb5e51c1e428cfe87d0dba91a8f01640',
    games=len(records),compared_states=sum(r['states'] for r in records),records=records)
Path(args.output).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='records'},indent=2))
