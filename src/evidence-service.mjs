import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rankWithJev, searchWorkspace } from './investigator.mjs';

const SMALL_PACKET_CHARS = 8_000;
const MAX_LARGE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_COMPLETE_FILE_BYTES = 256 * 1024;
const MAX_RANGE_LINES = 400;
const MAX_RANGE_CHARS = 48_000;
const SESSION_TTL_MS = 30 * 60 * 1_000;
const MAX_SESSIONS = 64;
const DEFAULT_RESULT_LIMIT = 4;
const CRITICAL_PATTERN = /\b(?:fatal|panic|unhandled|exception|error|failed|failure|segfault|caused by)\b/i;
const STACK_PATTERN = /^\s*(?:at\s|caused by:|\.\.\. \d+ more|file ".*", line \d+|[A-Za-z_$][\w.$]*(?:Error|Exception):)/i;
const SENSITIVE_PATTERN = /(?:^|[._-])(?:credential|credentials|secret|secrets)(?:[._-]|$)|\.(?:key|pem|p12|pfx)$/i;
const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'what', 'when', 'where', 'which', 'with', 'why']);

const sessions = new Map();

function boundedInteger(value, fallback, min, max, label) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer from ${min} to ${max}`);
  return number;
}

function isSensitivePath(path) {
  return path.split(/[\\/]/).some((part) => part === '.env' || part.toLowerCase().startsWith('.env.') || SENSITIVE_PATTERN.test(part));
}

function termsFrom(values) {
  const terms = [];
  for (const value of values) {
    for (const match of value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_.$/-]{2,}/gu) ?? []) {
      const term = match.replace(/^[./-]+|[./-]+$/g, '');
      if (term && !STOP_WORDS.has(term) && !terms.includes(term)) terms.push(term);
    }
  }
  return terms.slice(0, 64);
}

function packetChars(candidates) {
  return Buffer.byteLength(JSON.stringify(candidates.map(({ path, lines, excerpt }) => ({ path, lines, excerpt }))), 'utf8');
}

function pruneSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) if (session.createdAt < cutoff) sessions.delete(id);
  while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
}

function createSession(root, selected, diagnostics) {
  pruneSessions();
  const id = randomUUID();
  sessions.set(id, {
    root,
    createdAt: Date.now(),
    allowedPaths: new Set(selected.map((item) => item.path)),
    diagnostics,
  });
  return id;
}

async function canonicalDirectory(rootPath) {
  if (typeof rootPath !== 'string' || !rootPath.trim()) throw new Error('workspaceRoot is required');
  const root = await realpath(resolve(rootPath));
  const info = await stat(root);
  if (!info.isDirectory()) throw new Error('workspaceRoot must be a directory');
  return root;
}

function assertRelativePath(path) {
  if (typeof path !== 'string' || !path.trim() || isAbsolute(path)) throw new Error('path must be a non-empty workspace-relative path');
  if (isSensitivePath(path)) throw new Error('sensitive credential and key files are excluded');
}

async function resolveWorkspaceFile(root, path) {
  assertRelativePath(path);
  const absolute = resolve(root, path);
  const fromRoot = relative(root, absolute);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) throw new Error('path must stay inside the workspace root');
  const fileInfo = await lstat(absolute);
  if (fileInfo.isSymbolicLink()) throw new Error('symbolic-link files are excluded');
  const canonical = await realpath(absolute);
  const canonicalRelative = relative(root, canonical);
  if (canonicalRelative === '..' || canonicalRelative.startsWith(`..${sep}`) || isAbsolute(canonicalRelative)) throw new Error('resolved path leaves the workspace root');
  const info = await stat(canonical);
  if (!info.isFile()) throw new Error('path must identify a file');
  return { absolute: canonical, relativePath: canonicalRelative.split(sep).join('/'), size: info.size };
}

function renderLines(lines, start, end) {
  return lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n');
}

export function buildTextCandidates(path, text, query, requirements = [], options = {}) {
  const lines = text.split(/\r?\n/);
  const chunkLines = boundedInteger(options.chunkLines, 36, 12, 80, 'chunkLines');
  const overlap = Math.min(6, Math.floor(chunkLines / 4));
  const terms = termsFrom([query, ...requirements]);
  const ranges = [];

  for (let start = 1; start <= lines.length; start += chunkLines - overlap) {
    ranges.push({ start, end: Math.min(lines.length, start + chunkLines - 1), critical: false });
  }
  const criticalRanges = [];
  lines.forEach((line, index) => {
    if (!CRITICAL_PATTERN.test(line)) return;
    let end = Math.min(lines.length, index + 4);
    while (end < lines.length && end < index + 28 && (STACK_PATTERN.test(lines[end]) || /^\s+/.test(lines[end]))) end += 1;
    criticalRanges.push({ start: Math.max(1, index - 1), end, critical: true });
  });
  criticalRanges.sort((a, b) => a.start - b.start || a.end - b.end);
  for (const range of criticalRanges) {
    const previous = ranges.at(-1);
    if (previous?.critical && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else ranges.push(range);
  }

  const seenExact = new Set();
  const candidates = [];
  for (const range of ranges) {
    const raw = lines.slice(range.start - 1, range.end).join('\n');
    if (seenExact.has(raw)) continue;
    seenExact.add(raw);
    const folded = raw.toLowerCase();
    const matchedTerms = terms.filter((term) => folded.includes(term));
    if (!matchedTerms.length && !range.critical) continue;
    const termOccurrences = matchedTerms.reduce((sum, term) => sum + folded.split(term).length - 1, 0);
    candidates.push({
      path,
      lines: { start: range.start, end: range.end },
      excerpt: renderLines(lines, range.start, range.end).slice(0, 6_000),
      matchedTerms,
      critical: range.critical,
      localScore: matchedTerms.length * 100 + termOccurrences * 8 + (range.critical ? 250 : 0),
    });
  }
  candidates.sort((a, b) => Number(b.critical) - Number(a.critical) || b.localScore - a.localScore || a.lines.start - b.lines.start);
  return candidates.slice(0, boundedInteger(options.candidateLimit, 16, 1, 20, 'candidateLimit'));
}

async function selectCandidates({ query, requirements, candidates, resultLimit, apiKey, ask }) {
  const candidateChars = packetChars(candidates);
  if (candidateChars <= SMALL_PACKET_CHARS || candidates.length <= 2) {
    return { mode: 'bypass', selected: candidates.slice(0, resultLimit).map((candidate, index) => ({ candidate, index })), requests: 0, requestChars: 0, candidateChars };
  }
  if (!apiKey && !ask) {
    return {
      mode: 'local-fallback',
      selected: candidates.slice(0, resultLimit).map((candidate, index) => ({ candidate, index })),
      requests: 0,
      requestChars: 0,
      candidateChars,
      fallbackReason: 'TYPESAFE_API_KEY is not configured',
    };
  }
  try {
    const ranked = await rankWithJev(query, requirements, candidates, { resultLimit, apiKey, ask });
    const critical = candidates.filter((candidate) => candidate.critical);
    const selected = [...ranked.selected];
    for (const candidate of critical) {
      if (selected.some((item) => item.candidate === candidate)) continue;
      selected.unshift({ candidate, index: candidates.indexOf(candidate), relevance: undefined, requirementSupport: [] });
    }
    return { ...ranked, selected: selected.slice(0, resultLimit), candidateChars };
  } catch (error) {
    return {
      mode: 'local-fallback',
      selected: candidates.slice(0, resultLimit).map((candidate, index) => ({ candidate, index })),
      requests: 1,
      requestChars: Number.isInteger(error?.requestChars) ? error.requestChars : 0,
      candidateChars,
      fallbackReason: error instanceof Error ? error.message : 'Jev selection failed',
    };
  }
}

function publicEvidence(selected) {
  return selected.map(({ candidate }, index) => ({
    evidenceId: `e${index + 1}`,
    path: candidate.path,
    lines: candidate.lines,
    excerpt: candidate.excerpt,
    ...(candidate.critical ? { critical: true } : {}),
  }));
}

function selectorDiagnostics(selection) {
  return {
    mode: selection.mode,
    requestBytes: selection.requestChars,
    requests: selection.requests,
    ...(selection.model ? { model: selection.model } : {}),
    ...(selection.usage ? { usage: selection.usage } : {}),
    ...(Number.isInteger(selection.latencyMs) ? { latencyMs: selection.latencyMs } : {}),
    ...(selection.scored ? {
      scores: selection.scored.map((item) => ({
        path: item.candidate.path,
        lines: item.candidate.lines,
        relevance: item.relevance,
        requirementSupport: item.requirementSupport,
      })),
    } : {}),
    ...(selection.fallbackReason ? { fallbackReason: selection.fallbackReason } : {}),
  };
}

function compactMetrics(selection, evidence, extra = {}) {
  const returnedChars = packetChars(evidence);
  return {
    candidatesConsidered: extra.candidatesConsidered,
    evidenceReturned: evidence.length,
    candidatePacketChars: selection.candidateChars,
    returnedEvidenceChars: returnedChars,
    estimatedCandidateTokens: Math.ceil(selection.candidateChars / 4),
    estimatedReturnedTokens: Math.ceil(returnedChars / 4),
    jevRequests: selection.requests,
    ...(selection.usage ? { jevUsage: selection.usage } : {}),
    ...(Number.isInteger(selection.latencyMs) ? { jevLatencyMs: selection.latencyMs } : {}),
    ...extra,
  };
}

export async function searchWorkspaceEvidence(input, dependencies = {}) {
  const root = await canonicalDirectory(input.workspaceRoot);
  const requirements = input.requirements ?? [];
  const resultLimit = boundedInteger(input.resultLimit, DEFAULT_RESULT_LIMIT, 1, 8, 'resultLimit');
  const search = await searchWorkspace(root, input.query, requirements, {
    candidateLimit: boundedInteger(input.candidateLimit, 16, resultLimit, 20, 'candidateLimit'),
    resultLimit,
    maxFiles: input.maxFiles,
    maxScanBytes: input.maxScanBytes,
    maxExcerptChars: 1_800,
  });
  const selection = await selectCandidates({
    query: input.query,
    requirements,
    candidates: search.candidates,
    resultLimit,
    apiKey: dependencies.apiKey ?? process.env.TYPESAFE_API_KEY,
    ask: dependencies.ask,
  });
  const evidence = publicEvidence(selection.selected);
  const diagnostics = selectorDiagnostics(selection);
  const sessionId = createSession(root, evidence, diagnostics);
  const warnings = [];
  if (selection.fallbackReason) warnings.push(`Jev unavailable; deterministic local fallback used: ${selection.fallbackReason}`);
  if (search.metrics.scanTruncated) warnings.push('Workspace scan reached a configured limit; omitted files may contain relevant evidence.');
  return {
    mode: selection.mode,
    sessionId,
    evidence,
    metrics: compactMetrics(selection, evidence, {
      candidatesConsidered: search.candidates.length,
      filesVisited: search.metrics.filesVisited,
      filesMatched: search.metrics.filesMatched,
      scanTruncated: search.metrics.scanTruncated,
    }),
    ...(warnings.length ? { warnings } : {}),
    ...(input.includeDiagnostics ? { diagnostics } : {}),
  };
}

export async function readLargeTextEvidence(input, dependencies = {}) {
  const root = await canonicalDirectory(input.workspaceRoot);
  const file = await resolveWorkspaceFile(root, input.path);
  if (file.size > MAX_LARGE_FILE_BYTES) throw new Error(`file exceeds the ${MAX_LARGE_FILE_BYTES}-byte safety limit`);
  const bytes = await readFile(file.absolute);
  if (bytes.subarray(0, 8_192).includes(0)) throw new Error('binary files are excluded');
  const text = bytes.toString('utf8');
  const requirements = input.requirements ?? [];
  const resultLimit = boundedInteger(input.resultLimit, DEFAULT_RESULT_LIMIT, 1, 8, 'resultLimit');
  const candidates = buildTextCandidates(file.relativePath, text, input.query, requirements, { candidateLimit: input.candidateLimit });
  const selection = await selectCandidates({
    query: input.query,
    requirements,
    candidates,
    resultLimit,
    apiKey: dependencies.apiKey ?? process.env.TYPESAFE_API_KEY,
    ask: dependencies.ask,
  });
  const evidence = publicEvidence(selection.selected);
  const diagnostics = selectorDiagnostics(selection);
  const sessionId = createSession(root, evidence, diagnostics);
  const warnings = [];
  if (selection.fallbackReason) warnings.push(`Jev unavailable; deterministic local fallback used: ${selection.fallbackReason}`);
  if (!candidates.length) warnings.push('No query-matching or critical-error blocks were found.');
  return {
    mode: selection.mode,
    sessionId,
    evidence,
    metrics: compactMetrics(selection, evidence, { candidatesConsidered: candidates.length, fileBytes: file.size }),
    ...(warnings.length ? { warnings } : {}),
    ...(input.includeDiagnostics ? { diagnostics } : {}),
  };
}

export async function readSelectedEvidence(input) {
  pruneSessions();
  const session = sessions.get(input.sessionId);
  if (!session) throw new Error('sessionId is unknown or expired; run an evidence search again');
  if (!session.allowedPaths.has(input.path)) throw new Error('path was not selected in this evidence session');
  const file = await resolveWorkspaceFile(session.root, input.path);
  const bytes = await readFile(file.absolute);
  if (bytes.subarray(0, 8_192).includes(0)) throw new Error('binary files are excluded');
  const text = bytes.toString('utf8');
  const lines = text.split(/\r?\n/);
  if (input.complete) {
    if (file.size > MAX_COMPLETE_FILE_BYTES) throw new Error(`complete retrieval is limited to ${MAX_COMPLETE_FILE_BYTES} bytes; request a bounded line range`);
    return { sessionId: input.sessionId, path: file.relativePath, lines: { start: 1, end: lines.length }, content: renderLines(lines, 1, lines.length) };
  }
  const startLine = boundedInteger(input.startLine, 1, 1, Math.max(1, lines.length), 'startLine');
  const endLine = boundedInteger(input.endLine, Math.min(lines.length, startLine + 119), startLine, Math.min(lines.length, startLine + MAX_RANGE_LINES - 1), 'endLine');
  const content = renderLines(lines, startLine, endLine);
  if (content.length > MAX_RANGE_CHARS) throw new Error(`requested range exceeds ${MAX_RANGE_CHARS} characters; request fewer lines`);
  return { sessionId: input.sessionId, path: file.relativePath, lines: { start: startLine, end: endLine }, content };
}

export const limits = Object.freeze({
  smallPacketChars: SMALL_PACKET_CHARS,
  maxLargeFileBytes: MAX_LARGE_FILE_BYTES,
  maxCompleteFileBytes: MAX_COMPLETE_FILE_BYTES,
  maxRangeLines: MAX_RANGE_LINES,
  maxRangeChars: MAX_RANGE_CHARS,
  sessionTtlMs: SESSION_TTL_MS,
});
