import { useStore } from 'zustand';

// The command status line and the footer message (F7). Both read the store,
// which legacy setStatus/setFooter and the islands write, so a message sent
// before these islands mount still shows.
export default function StatusIsland() {
  const status = useStore(window.FinSight.store, (s) => s.status);
  return <div id="cmd-status" className={'cmd-status ' + status.kind}>{status.msg}</div>;
}
export function FooterIsland() {
  const footer = useStore(window.FinSight.store, (s) => s.footer);
  return <span id="footer-msg">{footer}</span>;
}
