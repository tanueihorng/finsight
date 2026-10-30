import { setMode, useMode } from './mode.ts';

// ◐ in the top bar: one click between the dark terminal and light mode.
export default function ModeIsland() {
  const mode = useMode();
  const next = mode === 'light' ? 'dark' : 'light';
  return (
    <button id="mode-btn" className="topbar-btn" aria-pressed={mode === 'light'} onClick={() => setMode(next)}
      title={`Switch to ${next} mode`} aria-label={`Switch to ${next} mode`}>◐</button>
  );
}
