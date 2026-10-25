import { useState } from 'react';
import { runCommand } from './runCommand.ts';

// Command bar (F7). Enter or GO runs the line and clears the input at once,
// like legacy; the result shows in the status line below (StatusIsland).
export default function CommandIsland() {
  const [text, setText] = useState('');
  const run = () => { const line = text; setText(''); void runCommand(line); };
  return (
    <>
      <span className="prompt">CMD&nbsp;&gt;</span>
      <input id="cmd" autoComplete="off" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
        placeholder="ADD AAPL 10 195.50   |   SELL AAPL 5   |   CASH USD 5000   |   UNDO   |   LEDGER   |   HELP" />
      <button id="cmd-go" className="go" onClick={run}>GO</button>
    </>
  );
}
