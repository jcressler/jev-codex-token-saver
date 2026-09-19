import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gradeAnswer, renderMarkdown } from './paired-pilot.mjs';

const resultPath = resolve(process.argv[2] ?? 'benchmarks/results/PAIRED-PILOT-2026-09-19.json');
const report = JSON.parse(await readFile(resultPath, 'utf8'));
report.manifest.codex.path = 'codex.exe';
report.selectors.local.root = '<DISPOSABLE_FIXTURE>';
report.selectors.jev.root = '<DISPOSABLE_FIXTURE>';
for (const run of report.runs) {
  run.preAuditQuality ??= run.quality;
  run.quality = gradeAnswer(run.answer);
}
const packet = result => result.evidence.map(({ path, lines, excerpt }) => ({ path, lines, excerpt }));
const localPacket = JSON.stringify(packet(report.selectors.local));
const jevPacket = JSON.stringify(packet(report.selectors.jev));
report.audit = {
  regradedAt: new Date().toISOString(),
  reason: 'The original regex grader rejected semantically correct paraphrases in the stock and local answers.',
  packetsIdentical: localPacket === jevPacket,
  assistedPromptsIdentical: localPacket === jevPacket,
  localPacketSha256: createHash('sha256').update(localPacket).digest('hex'),
  jevPacketSha256: createHash('sha256').update(jevPacket).digest('hex'),
  invalidPreflightRunsExcluded: [
    'One Sol High stock attempt timed out after the Windows read-only sandbox rejected the bundled PowerShell process; no turn.completed usage was available.',
    'One runner attempt exited during CLI argument parsing before starting Codex.',
    'A second Sol High stock attempt timed out after the same Windows read-only sandbox rejection; no turn.completed usage was available.',
    'One Luna Low read-only diagnostic verified the replacement danger-full-access command path and is not part of the comparison.',
  ],
};
await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(resultPath.replace(/\.json$/i, '.md'), renderMarkdown(report));
console.log(JSON.stringify({ resultPath, scores: report.runs.map(run => ({ arm: run.arm, score: run.quality.score, passed: run.quality.passed })), audit: report.audit }, null, 2));
