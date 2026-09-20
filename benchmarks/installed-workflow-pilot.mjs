import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { atomicJson, gradeAnswer, hashTree, parseCodexEvents, runProcess } from './evaluation-v2.mjs';
import { anonymizeAnswers } from './quality-review.mjs';

const TASKS = new Map([
  ['existing-diagnostics-file', {
    id: 'existing-diagnostics-file',
    query: 'A caller runs scripts/investigate.mjs with --diagnostics report.json, but report.json already exists. What happens to stdout and the process exit status, which code causes that behavior, and what is the minimal change if overwrite is intended while compact stdout must remain the default?',
    requirements: [
      'the order of investigation, diagnostic write, and compact stdout',
      'the exclusive file-write flag and resulting error path',
      'the process exit behavior',
      'the minimal overwrite change without changing compact stdout',
    ],
    rubric: {
      passingScore: 8,
      facts: [
        { id: 'exclusive-write', field: 'cause', weight: 2, all: ['writeFile', 'wx|exclusive|exist'] },
        { id: 'stdout', field: 'behavior', weight: 2, all: ['stdout', 'empty|no (?:compact )?(?:json|output)|nothing|before console|never reach'] },
        { id: 'exit', field: 'behavior', weight: 2, all: ['exit', '1|non-zero|failure'] },
        { id: 'fix', field: 'minimalChange', weight: 2, all: ['flag|writeFile', "'w'|\"w\"|overwrite|remove"] },
        { id: 'locations', field: 'codeLocations', weight: 2, all: ['scripts/investigate\\.mjs'] },
      ],
    },
  }],
  ['campaign-resume-budget-gates', {
    id: 'campaign-resume-budget-gates',
    query: 'Audit the evaluation v2 campaign controls. Why does a campaign state marked running or failed refuse automatic resume or retry, when is the cumulative token budget enforced, and why can the final allowed execution still cross that budget? Give the smallest hardening if a strict never-cross token ceiling is required.',
    requirements: [
      'the functions and state conditions that refuse automatic resume or retry',
      'the exact point at which cumulative usage is added and checked',
      'why checking between executions permits one-run overshoot',
      'the smallest conservative pre-launch hardening for a strict ceiling',
    ],
    rubric: {
      passingScore: 8,
      facts: [
        { id: 'resume-gate', field: 'cause', weight: 2, all: ['running|failed', 'resume|retry', 'refus|throw|cannot|forbid'] },
        { id: 'between-runs', field: 'behavior', weight: 2, all: ['after|between', 'usage|totals|budget', 'run|execution'] },
        { id: 'overshoot', field: 'behavior', weight: 2, all: ['final|one|next|overshoot', 'cross|exceed|overshoot', 'cap|budget|limit'] },
        { id: 'hardening', field: 'minimalChange', weight: 2, all: ['before|pre-launch|reserve', 'remaining|estimate|per-run|worst-case', 'budget|token|cap'] },
        { id: 'locations', field: 'codeLocations', weight: 2, all: ['benchmarks/evaluation-v2\\.mjs', 'benchmarks/evaluation-v2\\.test\\.mjs|benchmarks/EVALUATION-V2\\.md'] },
      ],
    },
  }],
]);
const EXPECTED_CODEX_VERSION = 'codex-cli 0.155.0-alpha.9.2';
const EXPECTED_CODEX_SHA256 = 'bc45017e8239dc150258f69309ced9df6bbcdf5b8e4f346decf780ac0999e226';

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['cause', 'codeLocations', 'behavior', 'minimalChange', 'confidence'],
  properties: {
    cause: { type: 'string' },
    codeLocations: { type: 'array', minItems: 1, items: { type: 'string' } },
    behavior: { type: 'string' },
    minimalChange: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

function options(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) parsed[argv[index]?.replace(/^--/, '')] = argv[index + 1];
  if (!['stock', 'jev'].includes(parsed.arm)) throw new Error('--arm must be stock or jev');
  if (!parsed['run-dir']) throw new Error('--run-dir is required');
  if (!parsed['codex-bin']) throw new Error('--codex-bin is required');
  const task = TASKS.get(parsed.task ?? 'existing-diagnostics-file');
  if (!task) throw new Error(`--task must be one of: ${[...TASKS.keys()].join(', ')}`);
  return { arm: parsed.arm, runDir: resolve(parsed['run-dir']), codexBin: resolve(parsed['codex-bin']), task };
}

function prompt(arm, task) {
  const request = `Investigate this read-only workspace and return the required JSON object.\n\nTask: ${task.query}\n\nRequired findings:\n${task.requirements.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\nCite relative file paths and line numbers. Do not modify files.`;
  if (arm === 'jev') return `${request}\n\nUse the $jev-codex-token-saver skill exactly once before opening files yourself. Transfer of the bounded query, requirements, relative paths, and excerpts to TypeSafe is authorized. Run its Jev mode with network allowed, then verify only the selected exact locations needed for the answer.`;
  return `${request}\n\nDo not invoke Jev or an evidence-selector plugin. Investigate with ordinary Codex file and search tools.`;
}

function codexArgs(fixture, schemaPath, taskPrompt) {
  return [
    'exec', '--ephemeral', '--skip-git-repo-check', '--json', '--color', 'never',
    '--output-schema', schemaPath, '-C', fixture, '-s', 'danger-full-access',
    '-m', 'gpt-5.6-sol', '-c', 'approval_policy="never"',
    '-c', 'model_reasoning_effort="high"', '-c', 'features.multi_agent=false',
    '-c', 'features.memories=false', '-c', 'features.apps=false',
    '-c', 'web_search="disabled"', taskPrompt,
  ];
}

async function copyFixture(destination) {
  for (const path of ['src', 'scripts', 'skills', 'tests', '.codex-plugin', 'README.md', 'package.json']) {
    await cp(resolve(path), join(destination, basename(path)), { recursive: true });
  }
  await mkdir(join(destination, 'benchmarks'), { recursive: true });
  for (const path of ['evaluation-v2.mjs', 'evaluation-v2.test.mjs', 'evaluation-v2.manifest.json', 'EVALUATION-V2.md', 'quality-review.mjs', 'quality-review.test.mjs']) {
    await cp(resolve('benchmarks', path), join(destination, 'benchmarks', path));
  }
  await cp(resolve('benchmarks', 'fixtures'), join(destination, 'benchmarks', 'fixtures'), { recursive: true });
}

async function main() {
  const { arm, runDir, codexBin, task } = options(process.argv.slice(2));
  const artifactDir = join(runDir, task.id, arm);
  const resultPath = join(artifactDir, 'result.json');
  try { await readFile(resultPath); throw new Error(`${arm} already ran; automatic retry is forbidden`); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (arm === 'jev' && !process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is required for the Jev arm');
  await mkdir(artifactDir, { recursive: true });
  const actualCodexSha256 = createHash('sha256').update(await readFile(codexBin)).digest('hex');
  if (actualCodexSha256 !== EXPECTED_CODEX_SHA256) throw new Error(`Codex binary SHA-256 mismatch: ${actualCodexSha256}`);
  const versionCheck = await runProcess(codexBin, ['--version'], {
    cwd: process.cwd(), env: process.env, timeoutMs: 10_000,
    stdoutPath: join(artifactDir, 'codex-version.stdout'), stderrPath: join(artifactDir, 'codex-version.stderr'),
  });
  if (versionCheck.code !== 0 || versionCheck.stdout.trim() !== EXPECTED_CODEX_VERSION) {
    throw new Error(`Codex version mismatch: ${versionCheck.stdout.trim() || versionCheck.stderr.trim()}`);
  }
  const schemaPath = join(runDir, 'answer.schema.json');
  try { await readFile(schemaPath); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(schemaPath, `${JSON.stringify(SCHEMA, null, 2)}\n`, { flag: 'wx' });
  }
  const fixture = await mkdtemp(join(tmpdir(), 'jev-installed-pilot-'));
  try {
    await copyFixture(fixture);
    const before = await hashTree(fixture);
    const diagnosticsPath = join(artifactDir, 'jev-diagnostics.json');
    const env = { ...process.env };
    if (arm === 'jev') env.JEV_CODEX_DIAGNOSTICS = diagnosticsPath;
    else { delete env.TYPESAFE_API_KEY; delete env.JEV_CODEX_DIAGNOSTICS; }
    const taskPrompt = prompt(arm, task);
    await writeFile(join(artifactDir, 'prompt.txt'), taskPrompt, { flag: 'wx' });
    const processResult = await runProcess(codexBin, codexArgs(fixture, schemaPath, taskPrompt), {
      cwd: fixture, env, timeoutMs: 300_000,
      stdoutPath: join(artifactDir, 'stdout.jsonl'), stderrPath: join(artifactDir, 'stderr.log'),
    });
    const parsed = parseCodexEvents(processResult.stdout);
    let answer;
    try { answer = JSON.parse(parsed.finalText); } catch { answer = undefined; }
    const after = await hashTree(fixture);
    const fixtureUnchanged = JSON.stringify(before) === JSON.stringify(after);
    let diagnostics;
    try { diagnostics = JSON.parse(await readFile(diagnosticsPath, 'utf8')); } catch {}
    const invocationVerified = arm === 'stock' || processResult.stdout.includes('investigate.mjs');
    const jevSucceeded = arm === 'stock' || diagnostics?.mode === 'jev';
    const quality = answer ? gradeAnswer(task, answer) : undefined;
    const withinBudget = (parsed.usage?.input_tokens ?? Infinity) <= 150_000 &&
      (parsed.usage?.output_tokens ?? Infinity) <= 8_000 && parsed.toolCalls <= 15;
    const status = processResult.code === 0 && !processResult.timedOut && fixtureUnchanged &&
      invocationVerified && jevSucceeded && quality?.passed && withinBudget ? 'completed' : 'failed';
    const result = {
      schemaVersion: 1, taskId: task.id, arm, model: 'gpt-5.6-sol', effort: 'high',
      codex: { path: codexBin, version: EXPECTED_CODEX_VERSION, sha256: actualCodexSha256 },
      process: { code: processResult.code, timedOut: processResult.timedOut, elapsedMs: processResult.elapsedMs },
      usage: parsed.usage, toolCalls: parsed.toolCalls, failedToolCalls: parsed.failedToolCalls,
      fixtureUnchanged, invocationVerified, jevSucceeded, withinBudget, diagnostics: diagnostics ? {
        mode: diagnostics.mode, metrics: diagnostics.metrics, jevModel: diagnostics.jevModel,
        warning: diagnostics.warning,
      } : undefined,
      answer, quality, status,
    };
    await atomicJson(resultPath, result);
    const taskDir = join(runDir, task.id);
    const pair = [];
    for (const pairArm of ['stock', 'jev']) {
      try { pair.push(JSON.parse(await readFile(join(taskDir, pairArm, 'result.json'), 'utf8'))); } catch {}
    }
    if (pair.length === 2) {
      const blinded = anonymizeAnswers(pair, `${task.id}:${EXPECTED_CODEX_SHA256}`);
      await atomicJson(join(taskDir, 'blind-review.json'), blinded.review);
      await atomicJson(join(taskDir, 'label-map.json'), blinded.mapping);
    }
    console.log(JSON.stringify(result, null, 2));
    if (status !== 'completed') throw new Error(`${arm} gate failed; inspect ${resultPath}; do not retry automatically`);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
