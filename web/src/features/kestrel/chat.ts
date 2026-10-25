import { createStore } from 'zustand/vanilla';
import { agentApi, AgentError, type Brain, type Citation, type Message, type Skill, type Thread } from './api.ts';
import { COMMANDS, ctxLabel, friendly, LS, ls, offlineWhy, randomVerb, suggestions, TOOL_VERBS, prettyTool, type PageContext } from './labels.ts';
import { addCite, addNotice, addText, addTool, endSegment, finish, newTurn, toolDone, type Turn } from './turns.ts';

// Kestrel chat state and actions (G1/G2). Lives outside React so the chat
// keeps its stream, turns and draft while the view moves between the side
// drawer and the dock (G3). Behaviour follows public/agent-panel.js.
export interface FileChip { name: string; kind: 'image' | 'document'; thumb: string | null; id: string | null; state: 'uploading' | 'ready' | 'notext' | 'error'; error?: string }
export type Item = { kind: 'user'; key: number; text: string; ctx: string; files: { name: string; kind?: string; thumb?: string | null }[] }
  | { kind: 'turn'; key: number; id: string } | { kind: 'notice'; key: number; text: string; cls: string };
export interface ChatState {
  name: string; named: boolean; brains: Brain[]; skills: Skill[]; defaultBrain: string | null; brain: string;
  thread: Thread | null; version: number; lastEventId: number;
  view: 'idle' | 'welcome' | 'log' | 'offline'; offline: { why: [string, string]; starting: boolean } | null;
  items: Item[]; turns: Record<string, Turn>; running: string | null; sending: boolean;
  status: { verb: string; start: number; chars: number }; files: FileChip[]; draft: string; threadsOpen: boolean; threads: Thread[] | null;
  stick: number; // bump to scroll the log to the bottom
  welcome: string[]; // the welcome's suggestions, fixed when it is shown (like legacy)
}
const initial = (): ChatState => ({
  name: 'Kestrel', named: false, brains: [], skills: [], defaultBrain: null, brain: '', thread: null, version: 0, lastEventId: 0,
  view: 'idle', offline: null, items: [], turns: {}, running: null, sending: false,
  status: { verb: '', start: 0, chars: 0 }, files: [], draft: '', threadsOpen: false, threads: null, stick: 0, welcome: [],
});
export const chat = createStore<ChatState>()(initial);
const get = () => chat.getState(), set = (p: Partial<ChatState>) => chat.setState(p);
let key = 0;
type NewItem = Item extends infer I ? (I extends unknown ? Omit<I, 'key'> : never) : never;
const push = (item: NewItem) => set({ items: [...get().items, { ...item, key: ++key } as Item], stick: get().stick + 1 });
export const notice = (text: string, cls = '') => push({ kind: 'notice', text, cls });
const scrollDown = () => set({ stick: get().stick + 1 });

// ---- turns ----
// Turns that ended before the POST /messages reply arrived: the reply must not mark them running.
const ended = new Set<string>();
function turn(id: string): Turn {
  const t = get().turns[id];
  if (t) return t;
  const created = newTurn(id);
  set({ turns: { ...get().turns, [id]: created } });
  push({ kind: 'turn', id });
  return created;
}
function updateTurn(id: string, fn: (t: Turn) => Turn) { const t = fn(turn(id)); set({ turns: { ...get().turns, [id]: t } }); }
export function setRunning(id: string | null) {
  set({ running: id, sending: false, status: id ? { verb: randomVerb(), start: Date.now(), chars: 0 } : get().status });
}
function done(id: string) { ended.add(id); if (get().running === id) setRunning(null); scrollDown(); }

// ---- models ----
export function pickBrain() {
  const s = get();
  const want = s.thread?.defaultBrain || ls.get(LS.brain, '') || s.defaultBrain;
  const ok = s.brains.find((b) => b.id === want && b.available) || s.brains.find((b) => b.available);
  set({ brain: ok ? ok.id : '' });
}
export function chooseBrain(id: string) { set({ brain: id }); ls.set(LS.brain, id); }

// ---- stream ----
let es: EventSource | null = null;
export function closeStream() { es?.close(); es = null; }
function openStream() {
  const thread = get().thread;
  if (!thread) return;
  closeStream();
  es = new EventSource(`/api/agent/threads/${thread.id}/events?after=${get().lastEventId}`);
  const on = <T,>(type: string, fn: (d: T) => void) => es!.addEventListener(type, (e) => {
    const ev = e as MessageEvent<string>;
    set({ lastEventId: Math.max(get().lastEventId, Number(ev.lastEventId) || 0) });
    let d = {} as T; try { d = JSON.parse(ev.data) as T; } catch { /* ignore */ }
    fn(d);
  });
  type D = { turnId: string; [k: string]: unknown };
  on<D>('turn.started', (d) => { setRunning(d.turnId); updateTurn(d.turnId, (t) => ({ ...t, label: String(d.label || '') })); if (d.skill) updateTurn(d.turnId, (t) => addNotice(t, `using skill ${d.skill}`, '')); });
  on<D>('message.delta', (d) => { const text = String(d.text || ''); updateTurn(d.turnId, (t) => addText(t, text)); set({ status: { ...get().status, chars: get().status.chars + text.length }, stick: get().stick + 1 }); });
  on<D>('tool.started', (d) => {
    updateTurn(d.turnId, (t) => addTool(t, d.callId as string | undefined, String(d.name), d.argsSummary as string | undefined));
    const verb = TOOL_VERBS[prettyTool(String(d.name))]; if (verb) set({ status: { ...get().status, verb } });
    scrollDown();
  });
  on<D>('tool.finished', (d) => updateTurn(d.turnId, (t) => toolDone(t, d.callId as string | undefined, String(d.name), !!d.ok, d.resultSummary as string | undefined, d.ms as number | undefined)));
  on<D & Citation>('citation', (d) => updateTurn(d.turnId, (t) => addCite(t, d)));
  on<D>('budget.warning', (d) => updateTurn(d.turnId, (t) => addNotice(t, String(d.note || 'Limit reached.'), 'warn')));
  on<D>('turn.retry', (d) => { updateTurn(d.turnId, (t) => addNotice(t, `model busy (${d.code}), retrying…`, 'warn')); set({ status: { ...get().status, verb: 'Waiting for the model' } }); });
  on<D>('turn.finished', (d) => { updateTurn(d.turnId, (t) => finish(t, { label: t.label, costUsd: d.costUsd as number | undefined, ms: d.ms as number | undefined })); done(d.turnId); });
  on<D>('turn.stopped', (d) => { updateTurn(d.turnId, (t) => finish(addNotice(t, 'Interrupted by you.', 'warn'), { label: t.label })); done(d.turnId); });
  on<D>('turn.failed', (d) => { updateTurn(d.turnId, (t) => finish(addNotice(t, friendly(d.code as string, d.message as string), 'error'), { label: t.label })); done(d.turnId); });
  es.onerror = () => { /* EventSource reconnects by itself with Last-Event-ID */ };
}

// ---- views ----
// What the user is looking at, sent with a message and used for the welcome's suggestions.
export function pageContext(): PageContext {
  const c: PageContext = { view: 'terminal' };
  try {
    const s = window.FinSight.store.getState();
    if (s.selected) c.symbol = String(s.selected).slice(0, 24);
    if (s.account) c.account = String(s.account).slice(0, 64);
    if (s.base) c.base = String(s.base).slice(0, 3);
    if (s.detailRange?.interval) c.timeframe = String(s.detailRange.interval).slice(0, 10);
    const strategy = (window.detailChart as unknown as { cfg?: { strategy?: string } } | null | undefined)?.cfg?.strategy;
    if (strategy) c.strategy = String(strategy).slice(0, 40);
  } catch { /* app not ready */ }
  return c;
}
export function showWelcome() { set({ view: 'welcome', items: [], turns: {}, welcome: suggestions(pageContext()) }); }
function clearLog() { set({ view: 'log', items: [], turns: {} }); }
export function newChat() {
  closeStream(); set({ thread: null, running: null, sending: false }); ls.set(LS.thread, ''); showWelcome();
}
function renderHistory(messages: Message[], citations: Citation[]) {
  const byTurn = new Map<string, Message[]>();
  for (const m of messages) { const k = m.turnId || m.id; if (!byTurn.has(k)) byTurn.set(k, []); byTurn.get(k)!.push(m); }
  for (const [k, msgs] of byTurn) {
    const user = msgs.find((m) => m.role === 'user' && m.blocks.some((b) => b.type === 'text'));
    if (user) {
      const pc = user.blocks.find((b) => b.type === 'notice' && b.kind === 'page_context');
      push({ kind: 'user', text: user.blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'), ctx: pc ? ctxLabel(pc.text) : '',
        files: user.blocks.filter((b) => b.type === 'attachment').map((b) => ({ name: String(b.name), kind: b.kind })) });
    }
    const asst = msgs.filter((m) => m.role !== 'user');
    if (!asst.length) continue;
    let brain = '';
    for (const m of asst) {
      if (m.brain) brain = m.brain;
      for (const b of m.blocks) {
        if (b.type === 'text' && m.role === 'assistant') updateTurn(k, (t) => endSegment(addText(t, String(b.text))));
        else if (b.type === 'tool_call') updateTurn(k, (t) => addTool(t, b.id, String(b.name), JSON.stringify(b.args || {})));
        else if (b.type === 'tool_result') updateTurn(k, (t) => toolDone(t, b.callId, String(b.name), !!b.ok, '', null));
        else if (b.type === 'notice' && m.role === 'assistant') updateTurn(k, (t) => addNotice(t, String(b.text), b.kind === 'error' || b.kind === 'refusal' ? 'error' : 'warn'));
      }
    }
    for (const c of citations.filter((x) => x.turnId === k)) updateTurn(k, (t) => addCite(t, c));
    const label = get().brains.find((b) => b.id === brain)?.label || brain;
    updateTurn(k, (t) => finish(t, { label }));
  }
}
export async function openThread(id: string) {
  const d = await agentApi<{ thread: Thread; messages: Message[]; citations?: Citation[]; lastEventId?: number; runningTurn?: string | null }>(`/threads/${id}`);
  closeStream();
  set({ thread: d.thread, version: d.thread.version, lastEventId: d.lastEventId || 0 });
  ls.set(LS.thread, id); pickBrain(); clearLog();
  renderHistory(d.messages, d.citations || []);
  setRunning(d.runningTurn || null);
  openStream(); scrollDown();
}

// ---- boot + offline ----
let retry: ReturnType<typeof setTimeout> | undefined;
export async function boot(): Promise<'ok' | 'locked'> {
  try {
    const [info, b, sk] = await Promise.all([agentApi<{ name?: string }>('/info').catch(() => ({} as { name?: string })), agentApi<{ brains: Brain[]; default: string }>('/brains'),
      agentApi<{ skills: Skill[] }>('/skills').catch(() => ({ skills: [] }))]);
    set({ name: info.name || get().name, named: get().named || !!info.name, brains: b.brains, defaultBrain: b.default, skills: sk.skills || [], offline: null });
    pickBrain();
    const saved = ls.get(LS.thread, '');
    if (saved) { try { await openThread(saved); return 'ok'; } catch { /* gone */ } }
    showWelcome();
  } catch (e) {
    const err = e as AgentError;
    if (err.status === 401) return 'locked'; // FinSight still locked: boot again after unlock
    if (err.code === 'AGENT_OFFLINE' || err.status === 503 || err.status === 502) { await showOffline(); return 'ok'; }
    if (get().view === 'idle') set({ view: 'log' });
    notice(`Could not reach the agent: ${err.message}`, 'error');
  }
  return 'ok';
}
export async function showOffline() {
  let st: { status?: string; logFile?: string } = {};
  try { st = await fetch('/api/agent-status', { credentials: 'same-origin' }).then((r) => r.json()); } catch { /* FinSight down */ }
  const o = offlineWhy(get().name, st);
  set({ view: 'offline', offline: o });
  clearTimeout(retry);
  if (o.starting) retry = setTimeout(() => void boot(), 2000);
}

// ---- threads ----
export async function listThreads() {
  const { threads } = await agentApi<{ threads: Thread[] }>('/threads');
  set({ threads });
}
export function toggleThreads(force?: boolean) {
  const show = force ?? !get().threadsOpen;
  set({ threadsOpen: show });
  if (show) listThreads().catch(() => {});
}
export async function deleteThread(t: Thread) {
  if (!confirm(`Delete "${t.title}" permanently?`)) return;
  await agentApi(`/threads/${t.id}?confirm=true`, { method: 'DELETE' });
  if (get().thread?.id === t.id) newChat();
  void listThreads();
}

// ---- attachments ----
const readB64 = (file: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
function patchFile(f: FileChip, p: Partial<FileChip>) { Object.assign(f, p); set({ files: [...get().files] }); }
export async function addFiles(list: FileList | File[]) {
  for (const file of [...list].slice(0, 5 - get().files.length)) {
    if (file.size > 15 * 1024 * 1024) { notice(`${file.name}: larger than 15 MB`, 'error'); continue; }
    const image = /^image\//.test(file.type);
    const f: FileChip = { name: file.name || 'pasted.png', kind: image ? 'image' : 'document', thumb: image ? URL.createObjectURL(file) : null, id: null, state: 'uploading' };
    set({ files: [...get().files, f] });
    try {
      const { upload } = await agentApi<{ upload: { id: string; kind: string; chars?: number } }>('/uploads', { method: 'POST', body: { name: f.name, dataBase64: await readB64(file) } });
      patchFile(f, { id: upload.id, state: upload.kind === 'document' && !upload.chars ? 'notext' : 'ready' });
    } catch (e) { patchFile(f, { state: 'error', error: (e as Error).message }); }
  }
}
export const removeFile = (i: number) => set({ files: get().files.filter((_, k) => k !== i) });

// ---- compose ----
export async function stop() {
  const t = get().thread;
  if (t) { try { await agentApi(`/threads/${t.id}/stop`, { method: 'POST', body: {} }); } catch { /* already done */ } }
}
async function slash(cmd: string) {
  const [c, ...rest] = cmd.slice(1).trim().split(/\s+/); const arg = rest.join(' ');
  const sys = (t: string) => { if (get().view === 'welcome') clearLog(); notice(t); };
  const s = get();
  if (c === 'new') return newChat();
  if (c === 'model') {
    const b = s.brains.find((x) => x.id === arg || x.label.toLowerCase().includes(arg.toLowerCase()));
    if (!arg || !b) return sys(`Models: ${s.brains.map((x) => `${x.id}${x.available ? '' : ' (n/a)'}`).join(', ')}`);
    if (!b.available) return sys(`${b.label} is not available: ${b.reason}`);
    chooseBrain(b.id); return sys(`Model set to ${b.label}.`);
  }
  if (c === 'cost') { const r = await agentApi<{ period: string; totalUsd: number; capUsdPerDay: number }>(`/cost?period=${arg === 'month' ? 'month' : 'day'}`); return sys(`Spend ${r.period === 'day' ? 'today' : 'this month'}: $${r.totalUsd.toFixed(4)} (daily cap $${r.capUsdPerDay}).`); }
  if (c === 'strategies') { const r = await agentApi<{ strategies: { name: string; id: string; status: string }[] }>('/strategies'); return sys(r.strategies.map((x) => `${x.name} (${x.id}) · ${x.status}`).join('\n')); }
  if (c === 'skills') return sys(s.skills.length ? s.skills.map((x) => `/${x.name} — ${x.description.slice(0, 90)}`).join('\n') : 'No skills installed.');
  if (c === 'logs') {
    const { lines } = await agentApi<{ lines: Record<string, unknown>[] }>('/logs?limit=1000');
    const bad = lines.filter((l) => l.ok === false || /error|failed/.test(String(l.kind)) || l.status === 'failed' || (Number(l.status) >= 500)).slice(-12);
    return sys(bad.length ? bad.map((l) => `${String(l.ts).slice(5, 19)} ${l.kind} ${l.tool || l.path || l.brain || ''} ${l.code || ''} ${l.error || l.message || ''}`.trim()).join('\n') : 'No recent errors in the interaction log.');
  }
  return sys(`${s.name} answers from your FinSight data, strategy library, records and the web. Commands: /new · /model <id> · /cost [month] · /strategies · /skills · /logs. Skills: type / to browse. Attach files with ⊕, paste or drop.`);
}
export async function submit(text: string, pc: PageContext | undefined, restore: (t: string) => void) {
  const s = get();
  if ((!text && !s.files.length) || s.view === 'offline') return;
  const cmd = text.match(/^\/([\w-]+)/);
  if (cmd && !s.skills.some((x) => x.name === cmd[1])) { restore(''); try { await slash(text); } catch (e) { notice((e as Error).message, 'error'); } return; }
  if (s.files.some((f) => f.state === 'uploading')) { notice('Wait for uploads to finish.', 'warn'); return; }
  const files = s.files.filter((f) => f.id);
  set({ sending: true });
  try {
    if (!get().thread) {
      const { thread } = await agentApi<{ thread: Thread }>('/threads', { method: 'POST', body: { brain: get().brain || undefined } });
      set({ thread, version: thread.version, lastEventId: 0 }); ls.set(LS.thread, thread.id);
      clearLog(); openStream();
    } else if (get().view === 'welcome') clearLog();
    push({ kind: 'user', text: text || '(attached files)', ctx: pc ? ctxLabel(pc) : '', files: files.map((f) => ({ name: f.name, kind: f.kind, thumb: f.thumb })) });
    restore(''); set({ files: [] });
    const k = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, '');
    const r = await agentApi<{ turnId: string; version: number }>(`/threads/${get().thread!.id}/messages`, { method: 'POST', body: {
      content: text || 'Please analyse the attached file(s).', brain: get().brain || undefined, pageContext: pc, idempotencyKey: k,
      expectedVersion: get().version, attachmentIds: files.length ? files.map((f) => f.id) : undefined } });
    set({ version: r.version });
    // intended fix (G): a turn that already ended (fast failure) is not marked running again.
    if (!get().running && !ended.has(r.turnId)) setRunning(r.turnId); else set({ sending: false });
    turn(r.turnId);
  } catch (e) {
    const err = e as AgentError;
    set({ sending: false });
    if (err.code === 'CONFLICT' && get().thread) { notice('This chat changed in another tab. Reloaded it; please resend.', 'warn'); await openThread(get().thread!.id); restore(text); return; }
    if (err.code === 'AGENT_OFFLINE') return void showOffline();
    notice(err.message, 'error'); restore(text);
  }
}
export function menuItems(draft: string) {
  const m = draft.match(/^\/([\w-]*)$/);
  if (!m) return null;
  const q = m[1]!.toLowerCase();
  const skills = get().skills.map((s) => ({ k: '/' + s.name, v: s.description, skill: true })).filter((x) => x.k.slice(1).includes(q));
  const cmds = COMMANDS.filter((c) => c.k.slice(1).startsWith(q));
  return skills.length || cmds.length ? { skills, cmds } : null;
}
export function setDraft(draft: string) { set({ draft }); }
export const resetChatForTests = () => chat.setState(initial(), true);
