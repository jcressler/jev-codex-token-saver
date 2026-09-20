#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readLargeTextEvidence, readSelectedEvidence, searchWorkspaceEvidence } from './evidence-service.mjs';

const requirements = z.array(z.string().min(1).max(240)).max(6).optional().describe('Distinct facts the returned evidence should cover.');
const resultLimit = z.number().int().min(1).max(8).optional().describe('Maximum evidence blocks returned to Codex.');
const candidateLimit = z.number().int().min(1).max(20).optional().describe('Hard cap from 1 to 20. Omit unless a smaller bounded candidate set is needed; never retry by increasing it.');

function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : 'Unexpected evidence tool failure';
  return { isError: true, content: [{ type: 'text', text: message }] };
}

const server = new McpServer(
  { name: 'jev-codex-token-saver', version: '0.3.0' },
  { instructions: 'For one investigation, make one search or large-text call. Obey all schema caps. Do not reformulate or retry if Jev returns no evidence or a tool rejects input; report that result. Use read_selected_evidence for wider context from a selected path.' },
);

server.registerTool('search_workspace_evidence', {
  title: 'Search workspace evidence with Jev',
  description: 'Searches a local workspace inside one tool call, uses Jev for eligible large candidate packets when TYPESAFE_API_KEY is configured, and returns only selected exact excerpts. Small packets bypass Jev; failures use a visible deterministic fallback.',
  inputSchema: {
    workspaceRoot: z.string().min(1).describe('Absolute root of the authorized workspace to search.'),
    query: z.string().min(1).max(2_000).describe('Concrete investigation question.'),
    requirements,
    resultLimit,
    candidateLimit,
    maxFiles: z.number().int().min(1).max(20_000).optional().describe('Hard scan cap; omit for the default. This is not a target.'),
    maxScanBytes: z.number().int().min(1_024).max(256 * 1024 * 1024).optional().describe('Hard byte cap; omit for the default. This is not a target.'),
    includeDiagnostics: z.boolean().optional().describe('Include Jev scores and selector telemetry for evaluation or debugging.'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (input) => {
  try { return toolResult(await searchWorkspaceEvidence(input)); } catch (error) { return errorResult(error); }
});

server.registerTool('read_large_text_evidence', {
  title: 'Read relevant evidence from a large text file',
  description: 'Reads and groups a large local text or log file inside one tool call, preserves critical error and stack-trace blocks, uses Jev for eligible large candidate packets, and returns bounded exact line ranges.',
  inputSchema: {
    workspaceRoot: z.string().min(1).describe('Absolute root of the authorized workspace.'),
    path: z.string().min(1).describe('Workspace-relative text or log path.'),
    query: z.string().min(1).max(2_000).describe('Concrete question to answer from the file.'),
    requirements,
    resultLimit,
    candidateLimit,
    includeDiagnostics: z.boolean().optional(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (input) => {
  try { return toolResult(await readLargeTextEvidence(input)); } catch (error) { return errorResult(error); }
});

server.registerTool('read_selected_evidence', {
  title: 'Read an exact selected source range',
  description: 'Retrieves an exact bounded line range, or a complete small selected file, from a prior evidence session. It cannot read unselected paths or leave that session workspace.',
  inputSchema: {
    sessionId: z.string().uuid().describe('Session identifier returned by a search or large-text tool.'),
    path: z.string().min(1).describe('A path selected by that session.'),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional(),
    complete: z.boolean().optional().describe('Return the complete selected file when it is within the complete-file limit.'),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (input) => {
  try { return toolResult(await readSelectedEvidence(input)); } catch (error) { return errorResult(error); }
});

const transport = new StdioServerTransport();
await server.connect(transport);
