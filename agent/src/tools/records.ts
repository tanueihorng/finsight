// Knowledge tools over the user's markdown records (policy, profile, decision
// log, reviews, research). Read-only. Paths are confined to the records root
// so a crafted argument cannot read arbitrary files.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolDef } from './registry.ts';
import { AgentError } from '../types.ts';
import { searchMessages } from '../store/db.ts';

function readRecord(root: string, rel: string, maxChars = 24_000): { path: string; modified: string; text: string; truncated: boolean } {
  const full = path.resolve(root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep)) throw new AgentError('PATH_DENIED', 'Path outside the records folder');
  let st: fs.Stats;
  try { st = fs.statSync(full); } catch { throw new AgentError('NOT_FOUND', `${rel} not found`); }
  const text = fs.readFileSync(full, 'utf8');
  return { path: rel, modified: st.mtime.toISOString(), text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

function walkMarkdown(root: string, limit = 400): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 4 || out.length >= limit) return;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) visit(p, depth + 1);
      else if (/\.(md|txt)$/i.test(e.name)) out.push(p);
    }
  };
  visit(root, 0);
  return out;
}

export const recordsTools: ToolDef[] = [
  {
    name: 'get_policy',
    description: 'The user\'s investment policy document. IMPORTANT: it states which rules are accepted and which are only proposals or placeholders; always say which applies.',
    input: z.object({}),
    async handler(_i, ctx) { return { source: 'records/INVESTMENT_POLICY.md', ...readRecord(ctx.cfg.recordsDir, 'INVESTMENT_POLICY.md') }; },
  },
  {
    name: 'get_profile',
    description: 'The user\'s investor profile (confirmed facts such as residency, goals, constraints; unknowns are marked).',
    input: z.object({}),
    async handler(_i, ctx) { return { source: 'records/INVESTOR_PROFILE.md', ...readRecord(ctx.cfg.recordsDir, 'INVESTOR_PROFILE.md') }; },
  },
  {
    name: 'get_decisions',
    description: 'Most recent entries of the user\'s decision log (proposals vs user decisions vs executions are distinguished in the log).',
    input: z.object({ maxChars: z.number().int().min(1000).max(24000).default(12000) }),
    async handler({ maxChars }, ctx) {
      const r = readRecord(ctx.cfg.recordsDir, 'DECISION_LOG.md', 1_000_000);
      return { source: 'records/DECISION_LOG.md', modified: r.modified, text: r.text.slice(-maxChars), note: 'Tail of the log (latest entries).' };
    },
  },
  {
    name: 'search_memory',
    description: 'Keyword search across the user\'s notes/reviews/research markdown and past chat threads. Returns matching passages with their source path.',
    input: z.object({ query: z.string().min(2).max(200), scope: z.enum(['notes', 'threads', 'all']).default('all'), limit: z.number().int().min(1).max(20).default(8) }),
    async handler({ query, scope, limit }, ctx) {
      const results: { source: string; snippet: string }[] = [];
      if (scope !== 'threads') {
        const terms = query.toLowerCase().split(/\s+/).filter((t: string) => t.length > 1);
        const scored: { source: string; snippet: string; score: number }[] = [];
        for (const f of walkMarkdown(ctx.cfg.recordsDir)) {
          const text = fs.readFileSync(f, 'utf8'); const low = text.toLowerCase();
          let score = 0, first = -1;
          for (const t of terms) { let i = low.indexOf(t); while (i !== -1) { score++; if (first === -1 || i < first) first = i; i = low.indexOf(t, i + t.length); } }
          if (score) scored.push({ source: path.relative(path.dirname(ctx.cfg.recordsDir), f), score, snippet: text.slice(Math.max(0, first - 200), first + 400).replace(/\s+/g, ' ') });
        }
        scored.sort((a, b) => b.score - a.score);
        results.push(...scored.slice(0, limit).map(({ source, snippet }) => ({ source, snippet })));
      }
      if (scope !== 'notes') results.push(...searchMessages(ctx.db, query, limit).map((m) => ({ source: `thread:${m.threadId}`, snippet: m.snippet })));
      return { query, results: results.slice(0, limit * 2) };
    },
  },
];
