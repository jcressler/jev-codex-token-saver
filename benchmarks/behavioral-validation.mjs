import { spawn } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const TASKS = {
  'tenant-cache-isolation': {
    fixture: 'tenant-cache',
    requiredFiles: ['src/cache.mjs', 'src/catalog.mjs', 'src/invalidation.mjs', 'tests/cache.test.mjs', 'tests/invalidation.test.mjs'],
    existingTests: ['tests/cache.test.mjs', 'tests/invalidation.test.mjs'],
    hiddenTest: tenantHiddenTest,
  },
  'webhook-raw-body-signature': {
    fixture: 'webhook-signature',
    requiredFiles: ['src/route.mjs', 'src/signature.mjs', 'src/body-parser.mjs', 'tests/body-parser.test.mjs', 'tests/signature.test.mjs'],
    existingTests: ['tests/body-parser.test.mjs', 'tests/signature.test.mjs'],
    hiddenTest: webhookHiddenTest,
  },
};

const REGRESSION_PATH = 'tests/submitted-regression.test.mjs';
const MAX_SOURCE_BYTES = 128 * 1024;
const MAX_TOTAL_SOURCE_BYTES = 256 * 1024;
const MAX_OUTPUT_CHARS = 12_000;
const MAX_REPLACEMENTS = 32;
const PROCESS_TIMEOUT_MS = 12_000;

function tenantHiddenTest() {
  return `import assert from 'node:assert/strict';
import test from 'node:test';
import { resetPrices } from '../src/cache.mjs';
import { catalogPrice } from '../src/catalog.mjs';

test('hidden behavior: tenant isolation, same-tenant reuse, and product scope', async () => {
  resetPrices();
  let loads = 0;
  const load = value => async () => { loads += 1; return value; };
  assert.equal(await catalogPrice('north', 'rose-1', load(14.99)), 14.99);
  assert.equal(await catalogPrice('north', 'rose-1', load(99.99)), 14.99);
  assert.equal(loads, 1, 'same tenant and product should reuse the cached value');
  assert.equal(await catalogPrice('south', 'rose-1', load(19.99)), 19.99);
  assert.equal(loads, 2, 'another tenant must load its own price');
  assert.equal(await catalogPrice('north', 'oak-2', load(39.99)), 39.99);
  assert.equal(loads, 3, 'another product must have its own entry');
  assert.equal(await catalogPrice('south', 'rose-1', load(88.88)), 19.99);
  assert.equal(loads, 3, 'each tenant/product pair should reuse its own value');
});
`;
}

function webhookHiddenTest() {
  return `import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { receiveWebhook } from '../src/route.mjs';

test('hidden behavior: verify exact bytes with whitespace and property order', () => {
  const secret = 'behavioral-fixture-secret';
  const rawBodies = [
    Buffer.from('{ "status": "paid", "id": 7 }'),
    Buffer.from('{"id":7,\\n  "status":"paid"}'),
  ];
  for (const rawBody of rawBodies) {
    const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
    assert.deepEqual(receiveWebhook(rawBody, signature, secret), { status: 'paid', id: 7 });
    const tampered = Buffer.from(rawBody);
    const valueStart = tampered.indexOf(Buffer.from('paid'));
    tampered[valueStart] = 'f'.charCodeAt(0);
    assert.throws(() => receiveWebhook(tampered, signature, secret), /signature/i);
    assert.throws(() => receiveWebhook(rawBody, '00'.repeat(32), secret), /signature/i);
  }
});
`;
}

const sandboxPreload = `import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import dns from 'node:dns';
import inspector from 'node:inspector';
const blocked = () => { throw new Error('network access is disabled during behavioral validation'); };
for (const name of ['connect', 'createConnection']) if (typeof net[name] === 'function') net[name] = blocked;
for (const name of ['connect']) if (typeof tls[name] === 'function') tls[name] = blocked;
for (const module of [http, https]) for (const name of ['request', 'get']) if (typeof module[name] === 'function') module[name] = blocked;
if (typeof dgram.createSocket === 'function') dgram.createSocket = blocked;
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) if (typeof dns[name] === 'function') dns[name] = blocked;
if (dns.promises) for (const name of Object.keys(dns.promises)) if (typeof dns.promises[name] === 'function') dns.promises[name] = blocked;
globalThis.fetch = blocked;
globalThis.WebSocket = class { constructor() { blocked(); } };
if (typeof inspector.open === 'function') inspector.open = blocked;
`;

function safeError(error) {
  return cap(error instanceof Error ? `${error.name}: ${error.message}` : String(error), 1_000);
}

function cap(value, max = MAX_OUTPUT_CHARS) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
}

function summarizeProcess(result) {
  return {
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    spawnError: result.spawnError,
    outputTruncated: result.outputTruncated,
    stdout: cap(result.stdout),
    stderr: cap(result.stderr),
  };
}

function runNode(args, cwd, sandboxRoot, timeoutMs = PROCESS_TIMEOUT_MS) {
  const sandboxPath = join(sandboxRoot, '.behavioral-network-block.mjs');
  const env = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATHEXT']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  const commandArgs = [
    '--permission',
    `--allow-fs-read=${sandboxRoot}`,
    '--import', pathToFileURL(sandboxPath).href,
    ...args,
  ];
  return new Promise(resolveResult => {
    let child;
    try {
      child = spawn(process.execPath, commandArgs, {
        cwd,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolveResult({ exitCode: null, timedOut: false, spawnError: safeError(error), outputTruncated: false, stdout: '', stderr: '' });
      return;
    }

    let stdout = '';
    let stderr = '';
    let outputTruncated = false;
    let timedOut = false;
    const append = (current, chunk) => {
      const text = chunk.toString();
      const remaining = MAX_OUTPUT_CHARS - current.length;
      if (text.length > remaining) outputTruncated = true;
      return current + text.slice(0, Math.max(0, remaining));
    };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timeout);
      resolveResult({ exitCode: null, timedOut, spawnError: safeError(error), outputTruncated, stdout, stderr });
    });
    child.once('close', code => {
      clearTimeout(timeout);
      resolveResult({ exitCode: code, timedOut, spawnError: null, outputTruncated, stdout, stderr });
    });
  });
}

async function listRelativeFiles(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const file = join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`fixture contains a symbolic link: ${relative(root, file)}`);
    if (entry.isDirectory()) files.push(...await listRelativeFiles(root, file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

async function hashTree(root) {
  const files = await listRelativeFiles(root);
  const hashes = new Map();
  for (const file of files) hashes.set(relative(root, file).replaceAll('\\', '/'), await readFile(file));
  return hashes;
}

function sameTree(left, right) {
  if (left.size !== right.size) return false;
  for (const [path, bytes] of left) {
    const other = right.get(path);
    if (!other || !bytes.equals(other)) return false;
  }
  return true;
}

function validateAnswer(taskId, fixtureRoot, answer) {
  const errors = [];
  const task = TASKS[taskId];
  if (typeof taskId !== 'string' || taskId.length > 128 || !task) errors.push('unknown or invalid taskId');
  if (typeof fixtureRoot !== 'string' || !fixtureRoot.trim()) errors.push('fixtureRoot must be a non-empty path');
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) errors.push('answer must be an object');
  if (answer && (typeof answer.cause !== 'string' || !answer.cause.trim() || answer.cause.length > 12_000)) errors.push('answer.cause must be a non-empty string of at most 12000 characters');
  if (answer && (!Array.isArray(answer.codeLocations) || answer.codeLocations.length === 0 || answer.codeLocations.length > 32 || answer.codeLocations.some(item => typeof item !== 'string' || item.length > 512))) errors.push('answer.codeLocations must contain 1 to 32 strings of at most 512 characters');
  if (answer && (!Array.isArray(answer.replacements) || answer.replacements.length === 0)) errors.push('answer.replacements must be a non-empty array');
  if (Array.isArray(answer?.replacements) && answer.replacements.length > MAX_REPLACEMENTS) errors.push(`answer.replacements may contain at most ${MAX_REPLACEMENTS} files`);
  if (answer && (!answer.regressionTest || typeof answer.regressionTest !== 'object' || Array.isArray(answer.regressionTest))) errors.push('answer.regressionTest must be an object');
  if (answer?.regressionTest && answer.regressionTest.path !== REGRESSION_PATH) errors.push(`regressionTest.path must be the designated regression test path`);
  if (answer?.regressionTest && (typeof answer.regressionTest.content !== 'string' || !answer.regressionTest.content.trim())) errors.push('regressionTest.content must be a non-empty string');

  let totalBytes = 0;
  const seen = new Set();
  if (Array.isArray(answer?.replacements)) {
    for (const replacement of answer.replacements) {
      if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
        errors.push('each replacement must be an object');
        continue;
      }
      const file = replacement.path;
      if (typeof file !== 'string' || !file || file.length > 512) {
        errors.push('replacement path must be a non-empty string of at most 512 characters');
        continue;
      }
      if (isAbsolute(file) || file.includes('\\') || file.split('/').some(part => !part || part === '.' || part === '..')) {
        errors.push('replacement path is not a safe relative path');
        continue;
      }
      if (!/^src\/(?:[^/]+\/)*[^/]+\.mjs$/.test(file)) {
        errors.push(`replacement must target an existing .mjs source file under src/: ${file}`);
        continue;
      }
      if (seen.has(file)) errors.push(`duplicate replacement path: ${file}`);
      seen.add(file);
      if (typeof replacement.content !== 'string' || !replacement.content.trim()) {
        errors.push(`replacement content must be a non-empty string: ${file}`);
        continue;
      }
      const bytes = Buffer.byteLength(replacement.content, 'utf8');
      totalBytes += bytes;
      if (bytes > MAX_SOURCE_BYTES) errors.push(`replacement is too large: ${file}`);
    }
  }
  totalBytes += typeof answer?.regressionTest?.content === 'string' ? Buffer.byteLength(answer.regressionTest.content, 'utf8') : 0;
  if (totalBytes > MAX_TOTAL_SOURCE_BYTES) errors.push('combined submitted source exceeds the size limit');
  return { task, errors };
}

function isSafeExistingSource(file) {
  return async root => {
    try {
      const segments = file.split('/');
      let current = root;
      for (const segment of segments) {
        current = join(current, segment);
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) return false;
      }
      const stat = await lstat(current);
      return stat.isFile();
    } catch {
      return false;
    }
  };
}

function safeRelativeTarget(root, file) {
  const target = resolve(root, ...file.split('/'));
  const fromRoot = relative(resolve(root), target);
  return fromRoot && !fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot);
}

function passedProcess(result) {
  return result.exitCode === 0 && !result.timedOut && !result.spawnError;
}

function passedTests(result) {
  const combined = `${result.stdout}\n${result.stderr}`;
  const count = Number(combined.match(/^ℹ tests (\d+)$/m)?.[1] ?? 0);
  return passedProcess(result) && count > 0 && /^ℹ fail 0$/m.test(combined);
}

function processInfraIssue(result) {
  return Boolean(result.timedOut || result.spawnError);
}

async function runStage({ name, tests, cwd, sandboxRoot, outputs, checks, infrastructureErrors }) {
  checks[name] = true;
  outputs[name] = {};
  const results = [];
  for (const testFile of tests) {
    const result = await runNode([testFile], cwd, sandboxRoot);
    results.push(result);
    outputs[name][testFile] = summarizeProcess(result);
    if (!passedTests(result)) checks[name] = false;
    if (processInfraIssue(result)) infrastructureErrors.push(`${name}:${testFile}: ${result.timedOut ? 'Node process timed out' : result.spawnError}`);
  }
  return results;
}

function isAssertionFailure(result) {
  const combined = `${result.stdout}\n${result.stderr}`;
  const failedTests = combined.match(/^ℹ fail (\d+)$/m);
  const assertionFailure = /AssertionError|ERR_ASSERTION/.test(combined);
  const sourceBehaviorFailure = /at TestContext\./.test(combined) && /src[\\/][^\r\n]+\.mjs/.test(combined);
  return result.exitCode !== 0 && !result.timedOut && !result.spawnError &&
    Number(failedTests?.[1] ?? 0) > 0 && (assertionFailure || sourceBehaviorFailure) &&
    !/SyntaxError|ERR_MODULE_NOT_FOUND|ERR_ACCESS_DENIED|Cannot find module|Cannot find package/.test(combined);
}

export async function validateBehavioralAnswer({ taskId, fixtureRoot, answer } = {}) {
  const validation = validateAnswer(taskId, fixtureRoot, answer);
  const checks = {
    schema: validation.errors.length === 0,
    allowedPaths: false,
    sourcePreserved: false,
    originalTests: false,
    regressionFailsOnOriginal: false,
    patchedTests: false,
    regressionPassesPatched: false,
    hiddenBehavior: false,
  };
  const outputs = {};
  const modelErrors = [...validation.errors];
  const infrastructureErrors = [];
  if (validation.errors.length) {
    return { taskId, passed: false, checks, outputs, modelErrors, infrastructureErrors };
  }

  const root = resolve(fixtureRoot);
  let scratch;
  try {
    const resolvedInput = await realpath(root);
    const originalTree = await hashTree(resolvedInput);
    const expectedBase = validation.task.fixture;
    for (const requiredFile of validation.task.requiredFiles) {
      if (!originalTree.has(requiredFile)) throw new Error(`fixtureRoot is missing required file: ${requiredFile}`);
    }
    for (const replacement of answer.replacements) {
      if (!safeRelativeTarget(resolvedInput, replacement.path) || !await isSafeExistingSource(replacement.path)(resolvedInput)) {
        modelErrors.push(`replacement must target an existing, non-symlink source file: ${replacement.path}`);
      }
    }
    checks.allowedPaths = modelErrors.length === validation.errors.length;
    if (!checks.allowedPaths) return { taskId, passed: false, checks, outputs, modelErrors, infrastructureErrors };

    scratch = await mkdtemp(join(tmpdir(), 'jev-behavior-'));
    const pristineRoot = join(scratch, 'pristine', expectedBase);
    const patchedRoot = join(scratch, 'patched', expectedBase);
    await mkdir(dirname(pristineRoot), { recursive: true });
    await mkdir(dirname(patchedRoot), { recursive: true });
    await cp(resolvedInput, pristineRoot, { recursive: true, errorOnExist: true, force: false });
    await cp(resolvedInput, patchedRoot, { recursive: true, errorOnExist: true, force: false });
    await writeFile(join(scratch, '.behavioral-network-block.mjs'), sandboxPreload, { flag: 'wx' });

    const pristineTree = await hashTree(pristineRoot);
    checks.sourcePreserved = sameTree(originalTree, await hashTree(resolvedInput));
    if (!checks.sourcePreserved) modelErrors.push('fixture source changed during validation');

    const originalSuite = await runStage({ name: 'originalTests', tests: validation.task.existingTests, cwd: pristineRoot, sandboxRoot: scratch, outputs, checks, infrastructureErrors });
    const pristineRegressionPath = join(pristineRoot, ...REGRESSION_PATH.split('/'));
    await mkdir(dirname(pristineRegressionPath), { recursive: true });
    await writeFile(pristineRegressionPath, answer.regressionTest.content, { flag: 'wx' });
    const regressionOnOriginal = await runNode([REGRESSION_PATH], pristineRoot, scratch);
    outputs.regressionOnOriginal = summarizeProcess(regressionOnOriginal);
    checks.regressionFailsOnOriginal = isAssertionFailure(regressionOnOriginal);
    if (processInfraIssue(regressionOnOriginal)) infrastructureErrors.push(`regressionOnOriginal: ${regressionOnOriginal.timedOut ? 'Node process timed out' : regressionOnOriginal.spawnError}`);
    else if (!checks.regressionFailsOnOriginal) modelErrors.push('submitted regression must fail on the original fixture through an assertion failure');
    checks.originalTests = originalSuite.length > 0 && originalSuite.every(passedTests);
    if (!checks.originalTests) modelErrors.push('existing original fixture tests did not pass');

    for (const replacement of answer.replacements) {
      const target = join(patchedRoot, ...replacement.path.split('/'));
      await writeFile(target, replacement.content, { flag: 'w' });
    }
    const patchedRegressionPath = join(patchedRoot, ...REGRESSION_PATH.split('/'));
    await mkdir(dirname(patchedRegressionPath), { recursive: true });
    await writeFile(patchedRegressionPath, answer.regressionTest.content, { flag: 'wx' });

    const patchedTree = await hashTree(patchedRoot);
    checks.patchedTests = true;
    for (const testFile of validation.task.existingTests) {
      const result = await runNode([testFile], patchedRoot, scratch);
      const key = `patchedTest:${testFile}`;
      outputs[key] = summarizeProcess(result);
      if (!passedTests(result)) checks.patchedTests = false;
      if (processInfraIssue(result)) infrastructureErrors.push(`${key}: ${result.timedOut ? 'Node process timed out' : result.spawnError}`);
    }
    if (!checks.patchedTests) modelErrors.push('one or more existing fixture tests failed after the patch');

    const regressionPatched = await runNode([REGRESSION_PATH], patchedRoot, scratch);
    outputs.regressionOnPatched = summarizeProcess(regressionPatched);
    checks.regressionPassesPatched = passedTests(regressionPatched);
    if (processInfraIssue(regressionPatched)) infrastructureErrors.push(`regressionOnPatched: ${regressionPatched.timedOut ? 'Node process timed out' : regressionPatched.spawnError}`);
    else if (!checks.regressionPassesPatched) modelErrors.push('submitted regression did not pass on the patched fixture');

    const hiddenPath = join(patchedRoot, 'tests', '.behavioral-hidden.test.mjs');
    await writeFile(hiddenPath, validation.task.hiddenTest(), { flag: 'wx' });
    const hidden = await runNode(['tests/.behavioral-hidden.test.mjs'], patchedRoot, scratch);
    outputs.hiddenBehavior = summarizeProcess(hidden);
    checks.hiddenBehavior = passedTests(hidden);
    if (processInfraIssue(hidden)) infrastructureErrors.push(`hiddenBehavior: ${hidden.timedOut ? 'Node process timed out' : hidden.spawnError}`);
    else if (!checks.hiddenBehavior) modelErrors.push('independent hidden behavior checks failed');

    checks.sourcePreserved = sameTree(originalTree, await hashTree(resolvedInput));
    if (!checks.sourcePreserved) modelErrors.push('fixture source changed during validation');
    outputs.fixtureIntegrity = { originalFileCount: pristineTree.size, patchedFileCount: patchedTree.size, passed: checks.sourcePreserved };
  } catch (error) {
    infrastructureErrors.push(safeError(error));
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true }).catch(error => infrastructureErrors.push(`temporary cleanup: ${safeError(error)}`));
  }

  return {
    taskId,
    passed: Object.values(checks).every(Boolean) && infrastructureErrors.length === 0,
    checks,
    outputs,
    modelErrors,
    infrastructureErrors,
  };
}
