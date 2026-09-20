import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('plugin config declares the local server and inherits only the Jev key', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
  const config = JSON.parse(await readFile(join(repoRoot, '.mcp.json'), 'utf8'));
  assert.equal(manifest.mcpServers, './.mcp.json');
  assert.deepEqual(config.mcpServers.jev_token_saver.env_vars, ['TYPESAFE_API_KEY']);
  assert.equal(config.mcpServers.jev_token_saver.command, 'node');
  assert.deepEqual(config.mcpServers.jev_token_saver.args, ['./dist/server.mjs']);
});

test('stdio MCP server discovers all tools and executes a real tool call', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['./dist/server.mjs'],
    cwd: repoRoot,
    env: { PATH: process.env.PATH ?? '' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'jev-token-saver-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    assert.match(client.getInstructions(), /Do not reformulate or retry/);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      'read_large_text_evidence',
      'read_selected_evidence',
      'search_workspace_evidence',
    ]);
    const called = await client.callTool({
      name: 'search_workspace_evidence',
      arguments: { workspaceRoot: repoRoot, query: 'McpServer StdioServerTransport', resultLimit: 2 },
    });
    assert.equal(called.isError, undefined);
    assert.equal(called.structuredContent.mode, 'bypass');
    assert.ok(called.structuredContent.evidence.length > 0);
    assert.equal(typeof called.structuredContent.sessionId, 'string');
    const selected = called.structuredContent.evidence[0];
    const followUp = await client.callTool({
      name: 'read_selected_evidence',
      arguments: {
        sessionId: called.structuredContent.sessionId,
        path: selected.path,
        startLine: 1,
        endLine: 5,
      },
    });
    assert.equal(followUp.isError, undefined);
    assert.equal(followUp.structuredContent.path, selected.path);
    assert.deepEqual(followUp.structuredContent.lines, { start: 1, end: 5 });
  } finally {
    await client.close();
  }
});
