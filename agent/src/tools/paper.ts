// Paper trading tools (FEAT-012). Kestrel can read the Alpaca paper
// account and place or cancel PAPER orders through FinSight. FinSight applies
// the user's approval mode (ask: a pending ticket the user approves; auto:
// sent at once) and limits; Kestrel can read those settings but not change them.
import { z } from 'zod';
import type { ToolDef } from './registry.ts';
import { AgentError } from '../types.ts';

const post = async (ctx: Parameters<ToolDef['handler']>[1], pathname: string, body: unknown) => {
  if (!ctx.finsight.post) throw new AgentError('FINSIGHT_ERROR', 'This FinSight client cannot place paper orders', 501);
  return ctx.finsight.post(pathname, body, ctx.signal);
};

const paperAccount: ToolDef = {
  name: 'paper_account',
  description: 'The Alpaca PAPER trading account (fake money, US stocks and ETFs): cash, equity, buying power, positions, open and recent orders (with who placed them), pending tickets awaiting the user, and the user\'s settings for your orders (approval ask/auto and limits). Call before placing a paper order.',
  input: z.object({}),
  async handler(_input, ctx) {
    const s = await ctx.finsight.get('/api/paper/state', {}, ctx.signal);
    if (!s.connected) return { connected: false, message: 'Alpaca paper is not connected. The user can connect paper API keys in FinSight PAPER mode.' };
    return s;
  },
};

const order = z.object({
  symbol: z.string().min(1).max(12).describe('US ticker, e.g. AAPL or BRK.B'),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit']).default('market'),
  qty: z.number().positive().optional().describe('Shares (fractional allowed for day orders). Give qty or notional, not both.'),
  notional: z.number().min(1).optional().describe('USD amount, market day orders only'),
  limitPrice: z.number().positive().optional().describe('Required for limit orders'),
  tif: z.enum(['day', 'gtc']).default('day'),
  note: z.string().max(500).optional().describe('One or two sentences on why, shown to the user with the order or ticket'),
});
const paperPlace: ToolDef<typeof order> = {
  name: 'paper_place_order',
  description: 'Place an order on the Alpaca PAPER account (fake money). Depending on the user\'s setting it is either sent at once (auto) or becomes a pending ticket the user approves or rejects in the terminal (ask). FinSight refuses it with a reason if it breaks one of the user\'s limits. Report exactly what came back: placed, pending approval or refused. Never describe a paper order as a real trade.',
  input: order,
  timeoutMs: 30_000,
  async handler(input, ctx) {
    return post(ctx, '/api/paper/orders', { ...input, threadId: ctx.threadId });
  },
};
const paperCancel: ToolDef = {
  name: 'paper_cancel_order',
  description: 'Cancel an open order on the Alpaca PAPER account by its order id (from paper_account). With approval set to ask, only orders you placed can be cancelled; FinSight refuses the user\'s own orders with a reason.',
  input: z.object({ id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/) }),
  async handler({ id }, ctx) { return post(ctx, '/api/paper/orders/cancel', { id }); },
};

export const paperTools: ToolDef[] = [paperAccount, paperPlace as unknown as ToolDef, paperCancel];
