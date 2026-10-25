// ⚙ Layout in the topbar (F10).
export default function LayoutButtonIsland() {
  return <button id="cards-btn" className="topbar-btn" title="Customise cards & panels" onClick={() => window.FinSight.store.setState({ layoutOpen: true })}>⚙ Layout</button>;
}
