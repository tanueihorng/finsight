// Claude Code as a brain: `claude -p` runs the whole turn with OUR tools
// attached over MCP (stdio). Locked down: empty scratch cwd, built-in tools
// limited to WebSearch/WebFetch, no shell/edit/write, no user settings,
// no session persistence, hard timeout.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { BrainManifest, CliBrain, TurnRequest, TurnResult } from './types.ts';
import type { Msg } from '../types.ts';
import { AgentError } from '../types.ts';
import { REPO_ROOT } from '../config.ts';

export function transcriptToPrompt(transcript: Msg[]): string {
  const lines: string[] = [];
  for (const m of transcript) {
    const text = m.blocks.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
    const tools = m.blocks.filter((b) => b.type === 'tool_call').map((b: any) => `[called ${b.name}]`).join(' ');
    if (m.role === 'user' && text) lines.push(`USER: ${text}`);
    if (m.role === 'assistant' && (text || tools)) lines.push(`ASSISTANT: ${[tools, text].filter(Boolean).join(' ')}`);
  }
  const last = lines.pop() ?? '';
  return (lines.length ? `Earlier conversation (for context):\n${lines.join('\n\n')}\n\n---\n` : '') + `Answer this latest message:\n${last.replace(/^USER: /, '')}`;
}

export function claudeCodeBrain(manifest: BrainManifest, scratchDir: string, env: NodeJS.ProcessEnv): CliBrain {
  return {
    kind: 'cli', manifest,
    turn(req: TurnRequest): Promise<TurnResult> {
      fs.mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
      for (const f of req.files ?? []) { try { fs.copyFileSync(f.path, path.join(scratchDir, f.name)); } catch { /* missing upload */ } }
      const fileNote = req.files?.length ? `\n\nAttached files in the current folder (use Read): ${req.files.map((f) => f.name).join(', ')}` : '';
      const mcpConfig = JSON.stringify({ mcpServers: { finsight: { command: process.execPath, args: [path.join(REPO_ROOT, 'src', 'cli.ts'), 'mcp'],
        env: { FINSIGHT_DATA_DIR: env.FINSIGHT_DATA_DIR ?? '', AGENT_HOME: env.AGENT_HOME ?? '', FINSIGHT_URL: env.FINSIGHT_URL ?? '', FINSIGHT_REPO: env.FINSIGHT_REPO ?? '', RECORDS_DIR: env.RECORDS_DIR ?? '' } } } });
      const args = ['-p', transcriptToPrompt(req.transcript) + fileNote, '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
        '--system-prompt', req.system, '--mcp-config', mcpConfig, '--strict-mcp-config',
        '--tools', 'WebSearch,WebFetch,Read', '--allowedTools', 'mcp__finsight__*', 'WebSearch', 'WebFetch', 'Read(./**)',
        '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'Task',
        '--setting-sources', '', '--no-session-persistence', '--model', manifest.model];
      return new Promise((resolve, reject) => {
        const child = spawn(String(manifest.options.command || 'claude'), args, { cwd: scratchDir, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
        const kill = () => child.kill('SIGTERM');
        const timer = setTimeout(() => { kill(); reject(new AgentError('BUDGET_EXCEEDED', `Claude Code turn exceeded ${req.timeoutMs / 1000}s`)); }, req.timeoutMs);
        req.signal.addEventListener('abort', kill, { once: true });
        let buf = '', finalText = '', streamed = '', result: any = null, stderr = '';
        const names = new Map<string, string>();
        child.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += String(d); });
        child.stdout.on('data', (chunk) => {
          buf += String(chunk);
          let nl: number;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (!line) continue;
            let j: any; try { j = JSON.parse(line); } catch { continue; }
            if (j.type === 'stream_event' && j.event?.type === 'content_block_delta' && j.event.delta?.type === 'text_delta') { streamed += j.event.delta.text; req.onEvent({ type: 'text', delta: j.event.delta.text }); }
            if (j.type === 'assistant') for (const c of j.message?.content || []) {
              if (c.type === 'tool_use') { names.set(c.id, c.name); req.onEvent({ type: 'tool.started', name: String(c.name).replace(/^mcp__finsight__/, ''), argsSummary: JSON.stringify(c.input ?? {}).slice(0, 160) }); }
              if (c.type === 'text') finalText = c.text;
            }
            if (j.type === 'user') for (const c of j.message?.content || []) {
              if (c.type === 'tool_result') req.onEvent({ type: 'tool.finished', name: String(names.get(c.tool_use_id) || 'tool').replace(/^mcp__finsight__/, ''), ok: !c.is_error, resultSummary: String(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 160) });
            }
            if (j.type === 'result') result = j;
          }
        });
        child.on('error', (e) => { clearTimeout(timer); reject(new AgentError('PROVIDER_ERROR', `Could not start Claude Code: ${e.message}`, 502)); });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (req.signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          if (!result && code !== 0) return reject(new AgentError('PROVIDER_ERROR', `Claude Code exited ${code}: ${stderr.slice(0, 300)}`, 502));
          if (result?.is_error) return reject(new AgentError('PROVIDER_ERROR', `Claude Code: ${String(result.result || result.subtype).slice(0, 300)}`, 502));
          const u = result?.usage || {};
          resolve({ text: String(result?.result ?? (finalText || streamed)),
            usage: { inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) || null, outputTokens: u.output_tokens ?? null, cacheReadTokens: u.cache_read_input_tokens ?? null },
            costUsd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null });
        });
      });
    },
  };
}
