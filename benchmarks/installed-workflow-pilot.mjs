import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { atomicJson, gradeAnswer, hashTree, parseCodexEvents, runProcess } from './evaluation-v2.mjs';

const TASK = {
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
};
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
  return { arm: parsed.arm, runDir: resolve(parsed['run-dir']), codexBin: resolve(parsed['codex-bin']) };
}

function prompt(arm) {
  const task = `Investigate this read-only workspace and return the required JSON object.\n\nTask: ${TASK.query}\n\nRequired findings:\n${TASK.requirements.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n\nCite relative file paths and line numbers. Do not modify files.`;
  if (arm === 'jev') return `${task}\n\nUse the $jev-codex-token-saver skill exactly once before opening files yourself. Transfer of the bounded query, requirements, relative paths, and excerpts to TypeSafe is authorized. Run its Jev mode with network allowed, then verify only the selected exact locations needed for the answer.`;
  return `${task}\n\nDo not invoke Jev or an evidence-selector plugin. Investigate with ordinary Codex file and search tools.`;
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
  for (const path of ['src', 'scripts', 'skills', '.codex-plugin', 'README.md', 'package.json']) {
    await cp(resolve(path), join(destination, basename(path)), { recursive: true });
  }
}

async function main() {
  const { arm, runDir, codexBin } = options(process.argv.slice(2));
  const artifactDir = join(runDir, arm);
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
    const taskPrompt = prompt(arm);
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
    const quality = answer ? gradeAnswer(TASK, answer) : undefined;
    const withinBudget = (parsed.usage?.input_tokens ?? Infinity) <= 150_000 &&
      (parsed.usage?.output_tokens ?? Infinity) <= 8_000 && parsed.toolCalls <= 15;
    const status = processResult.code === 0 && !processResult.timedOut && fixtureUnchanged &&
      invocationVerified && jevSucceeded && quality?.passed && withinBudget ? 'completed' : 'failed';
    const result = {
      schemaVersion: 1, taskId: TASK.id, arm, model: 'gpt-5.6-sol', effort: 'high',
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
    console.log(JSON.stringify(result, null, 2));
    if (status !== 'completed') throw new Error(`${arm} gate failed; inspect ${resultPath}; do not retry automatically`);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
