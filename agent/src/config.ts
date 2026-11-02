// Runtime configuration. Every value has a safe default; the optional file
// <home>/config.json overrides individual fields and is validated at startup,
// so a typo fails fast instead of silently changing behaviour.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const here = path.dirname(new URL(import.meta.url).pathname);
export const REPO_ROOT = path.resolve(here, '..');

// Kestrel's spending and tool limits. Editable in the terminal (PUT /v1/limits,
// PIN session only); an unset field uses the default.
export const LIMIT_DEFAULTS = { turnSteps: 25, turnSeconds: 300, turnUsd: 0.25, dayUsd: 5, searchesPerTurn: 20, fetchesPerTurn: 25, councilResearchCalls: 8 } as const;
const LimitsFile = z.object({
  turnSteps: z.number().int().min(1).max(50).optional(),
  turnSeconds: z.number().int().min(5).max(900).optional(),
  turnUsd: z.number().positive().max(100).optional(),
  councilTurnUsd: z.number().positive().max(100).optional(),
  councilOutputTokens: z.number().int().min(500).max(64000).optional(),
  councilResearchCalls: z.number().int().min(1).max(20).optional(),
  dayUsd: z.number().positive().max(1000).optional(),
  searchesPerTurn: z.number().int().min(0).max(50).optional(),
  fetchesPerTurn: z.number().int().min(0).max(50).optional(),
}).strict();
export type LimitsSet = z.infer<typeof LimitsFile>;
const FileConfig = z.object({
  port: z.number().int().min(1024).max(65535).optional(),
  finsightUrl: z.url().optional(),
  finsightDataDir: z.string().optional(),
  finsightRepo: z.string().optional(),
  recordsDir: z.string().optional(),
  defaultBrain: z.string().optional(),
  uiViews: z.boolean().optional(),
  council: z.boolean().optional(),
  assistantName: z.string().min(1).max(24).optional(),
  timezone: z.string().max(64).optional(),
  logRetentionDays: z.number().int().min(1).max(365).optional(),
  searchProvider: z.enum(['tavily', 'brave', 'deepseek', 'none']).optional(),
  fetchProvider: z.enum(['local', 'deepseek']).optional(),
  edgarUserAgent: z.string().optional(),
  limits: LimitsFile.optional(),
}).strict();

export type Limits = { turnSteps: number; turnSeconds: number; turnUsd: number; councilTurnUsd?: number; councilOutputTokens?: number; councilResearchCalls: number; dayUsd: number; searchesPerTurn: number; fetchesPerTurn: number };
export type Config = {
  council?: boolean;
  uiViews?: boolean; // default off; global env/config gate and qualified brain both required
  home: string; dbPath: string; port: number; finsightUrl: string; finsightDataDir: string; finsightRepo: string;
  recordsDir: string; pluginsDir: string; privateStrategiesDir: string; defaultBrain: string;
  searchProvider: 'tavily' | 'brave' | 'deepseek' | 'none'; fetchProvider: 'local' | 'deepseek'; edgarUserAgent: string; limits: Limits; scratchDir: string;
  timezone: string; assistantName: string; skillsDirs: { dir: string; source: 'bundled' | 'installed' }[]; logsDir: string; logRetentionDays: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const finsightDataDir = path.resolve(env.FINSIGHT_DATA_DIR || path.join(os.homedir(), 'FinSightData'));
  const home = path.resolve(env.AGENT_HOME || path.join(finsightDataDir, 'agent'));
  let file: z.infer<typeof FileConfig> = {};
  const cfgPath = path.join(home, 'config.json');
  if (fs.existsSync(cfgPath)) {
    const parsed = FileConfig.safeParse(JSON.parse(fs.readFileSync(cfgPath, 'utf8')));
    if (!parsed.success) throw new Error(`Invalid ${cfgPath}: ${parsed.error.message}`);
    file = parsed.data;
  }
  return {
    uiViews: env.KESTREL_UI === undefined ? (file.uiViews ?? (env.FINSIGHT_DEMO_MODE === '1')) : env.KESTREL_UI === '1',
    council: env.KESTREL_COUNCIL === undefined ? (file.council ?? false) : env.KESTREL_COUNCIL === '1',
    home,
    dbPath: path.join(home, 'agent.db'),
    port: Number(env.AGENT_PORT) || file.port || 8100,
    finsightUrl: env.FINSIGHT_URL || file.finsightUrl || 'http://127.0.0.1:8001',
    finsightDataDir: file.finsightDataDir ? path.resolve(file.finsightDataDir) : finsightDataDir,
    // The agent ships inside the FinSight repo (finsight/agent), so FinSight is the parent folder.
    finsightRepo: path.resolve(env.FINSIGHT_REPO || file.finsightRepo || path.resolve(REPO_ROOT, '..')),
    // Your policy/profile/decision-log markdown. Personal: set recordsDir in config.json; never inside the repo.
    recordsDir: path.resolve(env.RECORDS_DIR || file.recordsDir || path.join(finsightDataDir, 'records')),
    pluginsDir: path.join(REPO_ROOT, 'plugins'),
    privateStrategiesDir: path.join(finsightDataDir, 'strategies'),
    defaultBrain: env.AGENT_BRAIN || file.defaultBrain || 'deepseek-flash',
    searchProvider: file.searchProvider || 'tavily',
    fetchProvider: file.fetchProvider || 'local',
    edgarUserAgent: file.edgarUserAgent || 'FinSight-Agent personal research (contact: set edgarUserAgent in config.json)',
    limits: resolveLimits(file.limits),
    scratchDir: path.join(home, 'scratch'),
    assistantName: env.AGENT_NAME || file.assistantName || 'Kestrel',
    timezone: file.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    skillsDirs: [{ dir: path.join(REPO_ROOT, 'skills'), source: 'bundled' }, { dir: path.join(home, 'skills'), source: 'installed' }],
    logsDir: path.join(home, 'logs'),
    logRetentionDays: file.logRetentionDays ?? 14,
  };
}

export const resolveLimits = (l: LimitsSet = {}): Limits => ({ ...LIMIT_DEFAULTS, ...l });

/** Save the user's limits into config.json (other fields untouched; null
 *  clears a field back to its default) and apply them to the running config,
 *  which every turn reads afresh. */
export function saveLimits(cfg: Config, patch: Record<string, number | null>): LimitsSet {
  const cfgPath = path.join(cfg.home, 'config.json');
  const raw = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Record<string, unknown> : {};
  const merged: Record<string, unknown> = { ...(raw.limits as object | undefined) };
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete merged[k]; else merged[k] = v; }
  const limits = LimitsFile.parse(merged);
  const next = FileConfig.parse({ ...raw, limits });
  fs.mkdirSync(cfg.home, { recursive: true });
  const tmp = `${cfgPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, cfgPath);
  const resolved = resolveLimits(limits) as Limits & Record<string, unknown>;
  for (const k of Object.keys(cfg.limits)) if (!(k in resolved) || resolved[k] === undefined) delete (cfg.limits as Record<string, unknown>)[k];
  Object.assign(cfg.limits, resolved);
  return limits;
}
/** The limits explicitly set in config.json (the rest are defaults). */
export function setLimits(cfg: Config): LimitsSet {
  const cfgPath = path.join(cfg.home, 'config.json');
  if (!fs.existsSync(cfgPath)) return {};
  return LimitsFile.parse((JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as { limits?: unknown }).limits ?? {});
}
