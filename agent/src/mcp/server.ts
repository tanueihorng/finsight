// MCP server over stdio: exposes the same tool registry to Claude Code, Codex
// or any MCP client. stdout is the protocol channel; logs go to stderr.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Config } from '../config.ts';
import type { DB } from '../store/db.ts';
import type { ToolRegistry, ToolCtx } from '../tools/registry.ts';
import type { FinsightClient } from '../tools/finsight.ts';
import { log } from '../log.ts';

export async function runMcp(cfg: Config, db: DB, tools: ToolRegistry, finsight: FinsightClient, client = process.env.MCP_CLIENT || 'mcp'): Promise<void> {
  const server = new McpServer({ name: 'finsight', version: '0.1.0' });
  // One budget per MCP session (a CLI turn): same per-turn limits as the chat engine.
  const budget = { searches: cfg.limits.searchesPerTurn, fetches: cfg.limits.fetchesPerTurn };
  for (const t of tools.list()) {
    if (t.name === 'render_ui') continue; // no thread/turn UI bridge on MCP in Phase 1
    const shape = (t.input as any).shape ?? {};
    server.registerTool(t.name, { description: t.description, inputSchema: shape }, async (args: unknown) => {
      const ctx: ToolCtx = { cfg, db, finsight, signal: AbortSignal.timeout(t.timeoutMs ?? 60_000), budget, citations: [], via: `mcp:${client}` };
      const t0 = Date.now();
      const r = await tools.execute(t.name, args, ctx);
      log('info', 'mcp.tool', { client, tool: t.name, ok: r.ok, ms: Date.now() - t0 });
      const cites = ctx.citations.length ? `\n\nSOURCES:\n${ctx.citations.map((c) => `- ${c.title || c.url} <${c.url}> (retrieved ${c.retrievedAt.slice(0, 10)}, ${c.class})`).join('\n')}` : '';
      return { content: [{ type: 'text' as const, text: r.content + cites }], isError: !r.ok };
    });
  }
  await server.connect(new StdioServerTransport());
}
