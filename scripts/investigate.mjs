#!/usr/bin/env node
import { investigate } from '../src/investigator.mjs';

const HELP = `jev-codex-investigate — return focused evidence from a broad local search

Usage:
  jev-codex-investigate --root PATH --query TEXT [options]

Options:
  --requirement TEXT      Repeat up to 6 times
  --candidate-limit N     Local candidates sent to ranking (default 12, max 20)
  --result-limit N        Evidence excerpts returned (default 4, max 8)
  --jev                   Rank the bounded candidate set with Jev
  --allow-network         Required with --jev
  --model NAME            Jev model (default jev-1.13.0)
  --help                  Show this help

Local mode does not require a key. Jev mode reads TYPESAFE_API_KEY from the
environment and sends the query, requirements, relative paths, and bounded
candidate excerpts to TypeSafe. Secret-like files, symlinks, generated folders,
and common dependency folders are excluded.
`;

function parse(argv) {
  const values = { requirements: [] };
  const valueOptions = new Set(['--root', '--query', '--requirement', '--candidate-limit', '--result-limit', '--model']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') return { help: true };
    if (arg === '--jev') { values.useJev = true; continue; }
    if (arg === '--allow-network') { values.allowNetwork = true; continue; }
    if (!valueOptions.has(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = argv[++index];
    if (value === undefined) throw new Error(`${arg} requires a value`);
    if (arg === '--requirement') values.requirements.push(value);
    else if (arg === '--candidate-limit') values.candidateLimit = value;
    else if (arg === '--result-limit') values.resultLimit = value;
    else if (arg === '--root') values.root = value;
    else if (arg === '--query') values.query = value;
    else if (arg === '--model') values.model = value;
  }
  return values;
}

try {
  const values = parse(process.argv.slice(2));
  if (values.help) {
    console.log(HELP);
  } else {
    if (!values.root) throw new Error('--root is required');
    if (!values.query) throw new Error('--query is required');
    if (values.useJev && !values.allowNetwork) throw new Error('--allow-network is required when --jev is used');
    if (values.useJev && !process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is required when --jev is used');
    console.log(JSON.stringify(await investigate(values), null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
