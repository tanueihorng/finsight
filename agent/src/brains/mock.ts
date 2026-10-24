// Scripted brain for tests and offline demos. Each step pops the next scripted
// response; a function script can inspect the conversation (e.g. tool results).
import type { ApiBrain, BrainManifest, StepRequest, StepResult } from './types.ts';
import type { Block } from '../types.ts';

export type Script = (req: StepRequest, step: number) => Block[] | Promise<Block[]>;

export function mockBrain(manifest: BrainManifest, script: Script): ApiBrain {
  let n = 0;
  return {
    kind: 'api', manifest,
    async step(req): Promise<StepResult> {
      const blocks = await script(req, n++);
      for (const b of blocks) if (b.type === 'text') for (const part of b.text.match(/.{1,12}/gs) ?? []) { req.onText(part); await new Promise((r) => setTimeout(r, 1)); }
      return { blocks, usage: { inputTokens: 100, outputTokens: 20 }, stopReason: blocks.some((b) => b.type === 'tool_call') ? 'tool_use' : 'end' };
    },
  };
}
