import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { makePrompt, monitoredProcess, price, safeEnvironment, startEvidenceServer } from './controlled-workflow.mjs';
import { searchWorkspace } from '../src/investigator.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(join(repo,'benchmarks/evaluation-v2.manifest.json'),'utf8'));
const sha=value=>createHash('sha256').update(value).digest('hex');

test('broker runs one real selection per command, hides arm, blocks retries; Jev mocked offline',async()=>{
  const root=await mkdtemp(join(tmpdir(),'jev-broker-test-'));
  const task=manifest.tasks[0],fixture=join(repo,task.fixture);
  const search=await searchWorkspace(fixture,task.query,task.requirements,{candidateLimit:task.candidateLimit,resultLimit:task.resultLimit});
  for (const arm of ['local','jev']) {
    const artifactDir=join(root,arm);await mkdir(artifactDir);
    let rankCalls=0;
    const broker=await startEvidenceServer({arm,task,fixture,artifactDir,expectedCandidateHash:sha(JSON.stringify(search.candidates)),ranker:async(_q,_r,candidates)=>{
      rankCalls++;return {mode:'jev',model:'jev-1.13.0',usage:{input_tokens:100,output_tokens:10},selected:[{candidate:candidates[0]}]};
    }});
    try {
      const first=await fetch(broker.endpoint,{method:'POST'});assert.equal(first.status,200);
      const body=await first.json();assert.deepEqual(Object.keys(body),['evidence']);assert.ok(body.evidence.length);
      assert.equal((await fetch(broker.endpoint,{method:'POST'})).status,409);
      assert.equal(rankCalls,arm==='jev'?1:0);assert.equal(broker.state.duplicate,true);
    } finally {await broker.close();}
  }
});

test('broker fails closed on candidate drift and never calls Jev',async()=>{
  const root=await mkdtemp(join(tmpdir(),'jev-drift-test-'));
  let called=false;
  const broker=await startEvidenceServer({arm:'jev',task:manifest.tasks[0],fixture:join(repo,manifest.tasks[0].fixture),artifactDir:root,expectedCandidateHash:'wrong',ranker:async()=>{called=true;}});
  try {assert.equal((await fetch(broker.endpoint,{method:'POST'})).status,500);assert.equal(called,false);} finally {await broker.close();}
});

test('same assisted prompt, credential exclusion, and exclusive cache categories',()=>{
  const task=manifest.tasks[0];
  assert.equal(makePrompt(task,true,'C:/evidence.mjs'),makePrompt(task,true,'C:/evidence.mjs'));
  assert.ok(!makePrompt(task,true,'C:/evidence.mjs').includes('Jev'));
  assert.deepEqual(safeEnvironment({PATH:'x',TYPESAFE_API_KEY:'secret',OPENAI_API_KEY:'secret',CODEX_ACCESS_TOKEN:'secret',FAST_JEV_MODE:'jev'},'http://localhost'),{PATH:'x',EVIDENCE_ENDPOINT:'http://localhost'});
  assert.equal(price({input_tokens:100,cached_input_tokens:40,cache_write_input_tokens:20,output_tokens:10},{inputUsdPerMillion:4,cachedInputUsdPerMillion:.4,outputUsdPerMillion:20}),.000476);
});

test('monitor persists output and stops a runaway tool sequence without model calls',async()=>{
  const root=await mkdtemp(join(tmpdir(),'jev-monitor-test-'));
  const event=JSON.stringify({type:'item.started',item:{type:'command_execution'}});
  const script=`console.log(${JSON.stringify(event)});console.log(${JSON.stringify(event)});setInterval(()=>{},1000);`;
  const result=await monitoredProcess(process.execPath,['-e',script],{cwd:root,env:safeEnvironment(process.env),timeoutMs:10000,maxTools:1,artifactDir:root});
  assert.equal(result.stopReason,'tool-call-limit');assert.ok((await readFile(join(root,'stdout.jsonl'),'utf8')).includes('item.started'));
});
