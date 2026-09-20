import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashTree, parseCodexEvents, runProcess } from './evaluation-v2.mjs';
import { rankWithJev, searchWorkspace } from '../src/investigator.mjs';
import { validateBehavioralAnswer } from './behavioral-validation.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const tracked = ['src/investigator.mjs', 'benchmarks/controlled-workflow.mjs', 'benchmarks/behavioral-validation.mjs', 'benchmarks/evaluation-v2.mjs'];
const sha = value => createHash('sha256').update(value).digest('hex');
const load = async path => JSON.parse(await readFile(path, 'utf8'));
const save = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const packet = items => items.map(item => { const {path, lines, excerpt} = item.candidate ?? item; return {path, lines, excerpt}; });

export const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['cause', 'codeLocations', 'replacements', 'regressionTest'],
  properties: {
    cause: { type: 'string' },
    codeLocations: { type: 'array', items: { type: 'string' } },
    replacements: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } } },
    regressionTest: { type: 'object', additionalProperties: false, required: ['path', 'content'],
      properties: { path: { type: 'string' }, content: { type: 'string' } } },
  },
};

export function makePrompt(task, assisted, wrapper) {
  const base = `Investigate this disposable repository and provide a working minimal fix for this bug: ${task.query}\n\nRequired findings:\n${task.requirements.map((r,i) => `${i+1}. ${r}`).join('\n')}\n\nReturn the required JSON with a concise cause, codeLocations, full replacement contents for changed existing .mjs files under src/, and a regressionTest at tests/submitted-regression.test.mjs using node:test and node:assert/strict. The regression must fail by a behavioral assertion on the original code and pass on your replacements. Preserve existing public behavior and pass the existing tests. Do not replace existing tests. Do not modify files in this workspace; return proposed contents in JSON. You may read source and run existing tests or non-mutating probes. This is a temporary directory without Git; Git commands are unnecessary. Use PowerShell commands and keep exploration focused. Do not read parent directories, external repositories, credentials, or benchmark artifacts. Do not access the network except through the provided evidence command, if any.`;
  return assisted
    ? `${base}\n\nBegin by executing this ready-to-use evidence command exactly once: node "${wrapper.replaceAll('\\','/')}"\nIt returns selected source excerpts as data. After that, inspect any additional files needed for a correct patch. Do not inspect the command implementation or environment. No skill lookup or setup is needed.`
    : `${base}\n\nInvestigate using ordinary file and search tools. No evidence command is provided.`;
}

export function price(usage, prices) {
  const read = usage.cached_input_tokens ?? 0;
  const write = usage.cache_write_input_tokens ?? 0;
  return ((usage.input_tokens - read - write) * prices.inputUsdPerMillion + read * prices.cachedInputUsdPerMillion + write * prices.inputUsdPerMillion * 1.25 + usage.output_tokens * prices.outputUsdPerMillion) / 1e6;
}

export function safeEnvironment(base, endpoint) {
  const env = { ...base };
  for (const name of Object.keys(env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD/i.test(name) || /^(FAST_JEV_|JEV_|EVIDENCE_ENDPOINT$)/.test(name)) delete env[name];
  }
  if (endpoint) env.EVIDENCE_ENDPOINT = endpoint;
  return env;
}

async function codeHashes() { return Object.fromEntries(await Promise.all(tracked.map(async path => [path, sha(await readFile(join(repo, path)))]))); }

async function verifyFrozen(manifest) {
  assert.deepEqual(await codeHashes(), manifest.codeHashes, 'benchmark/selector code changed after freeze');
  assert.equal(sha(await readFile(manifest.codex.path)), manifest.codex.sha256, 'Codex binary changed');
  for (const task of manifest.tasks) assert.deepEqual(await hashTree(join(repo, task.fixture)), task.fixtureFiles, 'fixture changed');
}

async function prepare(runDir) {
  const prior = await load(join(here, 'evaluation-v2.manifest.json'));
  await mkdir(runDir, { recursive: false });
  const tasks = prior.tasks.map(({rubric, ...task}) => ({ ...task, resultLimit: 2 }));
  const plan = [
    ...['jev','local','stock'].map(arm => ({ taskId: tasks[0].id, arm })),
    ...['stock','local','jev'].map(arm => ({ taskId: tasks[1].id, arm })),
  ].map((item,index) => ({...item, runId: String(index+1).padStart(2,'0')}));
  const manifest = {
    schemaVersion: 1, frozenAt: new Date().toISOString(), model: 'gpt-5.6-sol', effort: 'high', jevModel: 'jev-1.13.0',
    codex: prior.codex, codeHashes: await codeHashes(), tasks, plan, pricing: prior.pricing,
    limits: { executions: 6, jevRequests: 2, timeoutMs: 180000, maxToolCallsPerRun: 10, inputStopThreshold: 650000, outputStopThreshold: 40000 },
    protocol: 'Two reused synthetic fixtures; one execution per arm/task, reversed arm order. Actual selector inside timed Codex run. No automatic retries. All attempts retained. Token thresholds are checked between runs, not hard in-flight token caps. Quality is executable behavior, never regex score. Does not measure natural installed-skill discovery or general savings.',
  };
  await verifyFrozen(manifest);
  await save(join(runDir,'manifest.json'), manifest);
  await save(join(runDir,'schema.json'), SCHEMA);
  const wrapper = `const url = process.env.EVIDENCE_ENDPOINT;\nif (!url) throw new Error('Evidence endpoint missing');\nconst response = await fetch(url, {method:'POST', signal:AbortSignal.timeout(20000)});\nconst result = await response.json();\nif (!response.ok) throw new Error(result.error ?? 'Evidence failed');\nconsole.log(JSON.stringify(result));\n`;
  await writeFile(join(runDir,'evidence.mjs'), wrapper, { flag:'wx' });
  const preflight = {};
  for (const task of tasks) {
    const fixture = join(repo,task.fixture);
    const tests = (await readdir(join(fixture,'tests'))).filter(p => p.endsWith('.test.mjs')).sort().map(p=>join('tests',p));
    const result = await runProcess(process.execPath,['--test',...tests], { cwd:fixture,env:safeEnvironment(process.env),timeoutMs:15000,stdoutPath:join(runDir,`${task.id}-baseline.stdout`),stderrPath:join(runDir,`${task.id}-baseline.stderr`) });
    assert.equal(result.code,0,'existing fixture tests must pass before the experiment');
    const search = await searchWorkspace(fixture,task.query,task.requirements,{candidateLimit:task.candidateLimit,resultLimit:task.resultLimit});
    preflight[task.id] = {baselinePassed:true,candidateSha256:sha(JSON.stringify(search.candidates)),candidates:search.candidates};
  }
  await save(join(runDir,'preflight.json'),preflight);
  await save(join(runDir,'prepared.json'),{manifestSha256:sha(JSON.stringify(manifest)),wrapperSha256:sha(wrapper),schemaSha256:sha(JSON.stringify(SCHEMA)),preflightSha256:sha(JSON.stringify(preflight))});
  console.log(JSON.stringify({status:'prepared-offline',runDir,executions:6,jevRequests:2,plan},null,2));
}

export async function startEvidenceServer({arm,task,fixture,artifactDir,expectedCandidateHash,apiKey,ranker=rankWithJev}) {
  const state = {calls:0,requests:0,status:'not-called'};
  const token = randomUUID();
  const server = createServer(async (req,res) => {
    res.setHeader('content-type','application/json');
    if (req.method !== 'POST' || req.url !== `/${token}`) { res.writeHead(404).end('{}'); return; }
    state.calls++;
    if (state.calls !== 1) { state.duplicate=true; res.writeHead(409).end(JSON.stringify({error:'Evidence command may run only once'})); return; }
    const start=performance.now();
    try {
      const search=await searchWorkspace(fixture,task.query,task.requirements,{candidateLimit:task.candidateLimit,resultLimit:task.resultLimit});
      assert.equal(sha(JSON.stringify(search.candidates)),expectedCandidateHash,'candidate drift');
      await save(join(artifactDir,'candidates.json'),search.candidates);
      let chosen;
      if (arm === 'jev') {
        state.requests++;
        const ranking=await ranker(task.query,task.requirements,search.candidates,{
          apiKey,model:'jev-1.13.0',resultLimit:task.resultLimit,timeoutMs:15000,
          onRequest: request => save(join(artifactDir,'jev-request.json'),request),
          onResponse: response => save(join(artifactDir,'jev-response.json'),response),
        });
        assert.equal(ranking.mode,'jev');
        assert.equal(ranking.model,'jev-1.13.0');
        assert.ok(ranking.usage && Number.isFinite(ranking.usage.input_tokens),'Jev usage is required');
        state.usage=ranking.usage;
        chosen=packet(ranking.selected);
      } else chosen=packet(search.candidates.slice(0,task.resultLimit));
      state.status='completed'; state.elapsedMs=Math.round(performance.now()-start);
      state.evidenceSha256=sha(JSON.stringify(chosen)); state.evidenceChars=JSON.stringify(chosen).length;
      await save(join(artifactDir,'evidence.json'),chosen);
      res.end(JSON.stringify({evidence:chosen}));
    } catch (error) {
      state.status='failed'; state.error=String(error?.message??error); state.elapsedMs=Math.round(performance.now()-start);
      res.writeHead(500).end(JSON.stringify({error:state.error}));
    }
  });
  await new Promise((done,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  return {state,endpoint:`http://127.0.0.1:${server.address().port}/${token}`,close:async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));}};
}

export async function monitoredProcess(binary,args,{cwd,env,timeoutMs,maxTools,artifactDir}) {
  const startedAt=new Date().toISOString(),started=performance.now();
  const stdoutFile=createWriteStream(join(artifactDir,'stdout.jsonl'),{flags:'wx'});
  const stderrFile=createWriteStream(join(artifactDir,'stderr.log'),{flags:'wx'});
  const child=spawn(binary,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',pending='',toolCalls=0,stopReason=null;
  const stop=reason=>{if (!stopReason) {
    stopReason=reason;
    if (process.platform==='win32' && child.pid) {
      // Only terminate the process tree created by this execution.
      const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
      killer.once('error',()=>child.kill());
    } else child.kill();
  }};
  const timer=setTimeout(()=>stop('timeout'),timeoutMs);
  child.stdout.on('data',chunk=>{
    const text=chunk.toString(); stdout+=text; pending+=text; stdoutFile.write(text);
    let newline;
    while ((newline=pending.indexOf('\n'))>=0) {
      const line=pending.slice(0,newline);pending=pending.slice(newline+1);
      try {
        const event=JSON.parse(line);
        if (event.type==='item.started' && ['command_execution','mcp_tool_call','web_search'].includes(event.item?.type)) {
          toolCalls++; if (toolCalls>maxTools) stop('tool-call-limit');
        }
      } catch { /* Non-event stdout is preserved verbatim. */ }
    }
  });
  child.stderr.on('data',chunk=>{stderr+=chunk.toString();stderrFile.write(chunk);});
  let code;
  try { code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);}); }
  finally {
    clearTimeout(timer);
    await Promise.all([new Promise(done=>stdoutFile.end(done)),new Promise(done=>stderrFile.end(done))]);
  }
  const result={code,stopReason,startedAt,finishedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()-started),stdout,stderr};
  return result;
}

async function execute(runDir) {
  const manifest=await load(join(runDir,'manifest.json'));
  const prepared=await load(join(runDir,'prepared.json'));
  assert.equal(sha(JSON.stringify(manifest)),prepared.manifestSha256);
  assert.equal(sha(await readFile(join(runDir,'evidence.mjs'))),prepared.wrapperSha256);
  assert.equal(sha(JSON.stringify(await load(join(runDir,'schema.json')))),prepared.schemaSha256);
  const preflight=await load(join(runDir,'preflight.json'));
  assert.equal(sha(JSON.stringify(preflight)),prepared.preflightSha256);
  await verifyFrozen(manifest);
  assert.ok(process.env.TYPESAFE_API_KEY,'Jev credential required before any model starts');
  await save(join(runDir,'started.json'),{startedAt:new Date().toISOString(),manifestSha256:prepared.manifestSha256});
  const results=[]; let stopReason=null;
  for (const plan of manifest.plan) {
    const inputs=results.reduce((sum,r)=>sum+(r.usage?.input_tokens??0),0);
    const outputs=results.reduce((sum,r)=>sum+(r.usage?.output_tokens??0),0);
    if (inputs>=manifest.limits.inputStopThreshold || outputs>=manifest.limits.outputStopThreshold) {stopReason='between-run-token-threshold';break;}
    await verifyFrozen(manifest);
    const task=manifest.tasks.find(t=>t.id===plan.taskId);
    const artifactDir=join(runDir,plan.runId); await mkdir(artifactDir);
    const fixture=join(artifactDir,'workspace'); await cp(join(repo,task.fixture),fixture,{recursive:true});
    assert.deepEqual(await hashTree(fixture),task.fixtureFiles);
    const assisted=plan.arm!=='stock';
    const broker=assisted?await startEvidenceServer({arm:plan.arm,task,fixture,artifactDir,expectedCandidateHash:preflight[task.id].candidateSha256,apiKey:process.env.TYPESAFE_API_KEY}):null;
    const prompt=makePrompt(task,assisted,join(runDir,'evidence.mjs'));
    const args=['exec','--ephemeral','--ignore-user-config','--ignore-rules','--skip-git-repo-check','--json','--color','never','--output-schema',join(runDir,'schema.json'),'-C',fixture,'-s','danger-full-access','-m',manifest.model,
      '-c','approval_policy="never"','-c',`model_reasoning_effort="${manifest.effort}"`,'-c','features.multi_agent=false','-c','features.memories=false','-c','features.apps=false','-c','features.plugin_hooks=false','-c','features.skip_host_skill_discovery=true','-c','features.shell_tool=true','-c','web_search="disabled"','-c','shell_environment_policy.inherit="all"',prompt];
    await writeFile(join(artifactDir,'prompt.txt'),prompt,{flag:'wx'});
    await save(join(artifactDir,'launch.json'),{...plan,args,fixtureFiles:task.fixtureFiles,startedAt:new Date().toISOString()});
    console.log(JSON.stringify({event:'launch',...plan}));
    let processResult;
    try {processResult=await monitoredProcess(manifest.codex.path,args,{cwd:fixture,env:safeEnvironment(process.env,broker?.endpoint),timeoutMs:manifest.limits.timeoutMs,maxTools:manifest.limits.maxToolCallsPerRun,artifactDir});}
    finally {if(broker) await broker.close();}
    const parsed=parseCodexEvents(processResult.stdout);
    let answer=null,answerError=null;
    try {answer=JSON.parse(parsed.finalText);} catch {answerError='Invalid final JSON';}
    const unchanged=JSON.stringify(await hashTree(fixture))===JSON.stringify(task.fixtureFiles);
    const selector=broker?broker.state:{status:'not-applicable',calls:0,requests:0};
    const usageValid=parsed.usage && ['input_tokens','cached_input_tokens','output_tokens'].every(k=>Number.isFinite(parsed.usage[k])&&parsed.usage[k]>=0) && parsed.usage.input_tokens>=parsed.usage.cached_input_tokens+(parsed.usage.cache_write_input_tokens??0);
    const integrity=processResult.code===0 && !processResult.stopReason && usageValid && unchanged && !answerError && (!assisted||(selector.calls===1&&selector.status==='completed'&&!selector.duplicate));
    const result={...plan,process:{code:processResult.code,stopReason:processResult.stopReason,startedAt:processResult.startedAt,finishedAt:processResult.finishedAt,elapsedMs:processResult.elapsedMs},usage:parsed.usage,toolCalls:parsed.toolCalls,failedToolCalls:parsed.failedToolCalls,fixtureUnchanged:unchanged,selector,answer,answerError,integrity};
    await save(join(artifactDir,'result.json'),result);results.push(result);
    console.log(JSON.stringify({event:'finished',runId:plan.runId,arm:plan.arm,integrity,input:parsed.usage?.input_tokens,output:parsed.usage?.output_tokens,toolCalls:parsed.toolCalls,failedToolCalls:parsed.failedToolCalls}));
    if (!integrity) {stopReason='integrity-gate';break;}
  }
  // No rubric feedback or answer changes are allowed to influence subsequent executions.
  for (const result of results) {
    if (!result.answer) continue;
    const quality=await validateBehavioralAnswer({taskId:result.taskId,fixtureRoot:join(runDir,result.runId,'workspace'),answer:result.answer});
    await save(join(runDir,result.runId,'quality.json'),quality);result.quality=quality;
  }
  const aggregates={};
  for (const arm of ['stock','local','jev']) {
    const items=results.filter(r=>r.arm===arm);const sum=fn=>items.reduce((n,r)=>n+fn(r),0);
    aggregates[arm]={runs:items.length,qualityPasses:sum(r=>Number(r.quality?.passed===true)),inputTokens:sum(r=>r.usage?.input_tokens??0),cachedInputTokens:sum(r=>r.usage?.cached_input_tokens??0),outputTokens:sum(r=>r.usage?.output_tokens??0),toolCalls:sum(r=>r.toolCalls),failedToolCalls:sum(r=>r.failedToolCalls),elapsedMs:sum(r=>r.process.elapsedMs),jevInputTokens:sum(r=>r.selector.usage?.input_tokens??0),jevOutputTokens:sum(r=>r.selector.usage?.output_tokens??0),apiEquivalentUsd:sum(r=>r.usage?price(r.usage,manifest.pricing.codexApiEquivalent)+(r.selector.usage?.input_tokens??0)*manifest.pricing.jev.inputUsdPerMillion/1e6+(r.selector.usage?.output_tokens??0)*manifest.pricing.jev.outputUsdPerMillion/1e6:0)};
  }
  const summary={status:!stopReason&&results.length===6?'completed':'stopped',stopReason,manifestSha256:prepared.manifestSha256,aggregates,results,interpretation:manifest.protocol};
  await save(join(runDir,'summary.json'),summary);
  console.log(JSON.stringify({event:'campaign-finished',status:summary.status,stopReason,aggregates},null,2));
  if (summary.status!=='completed') process.exitCode=1;
}

async function main() {
  const [mode,runFlag,path,...extra]=process.argv.slice(2);
  assert.ok(['--prepare','--run'].includes(mode)&&runFlag==='--run-dir'&&path&&extra.length===0,'usage: --prepare|--run --run-dir PATH');
  const runDir=resolve(path);
  if (mode==='--prepare') await prepare(runDir); else await execute(runDir);
}
if (process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.message);process.exitCode=1;});
