import { useStore } from 'zustand';
import { firstName, profile } from './profile.ts';

// ◐ Profile button (F8): shows the first name and reopens the setup modal.
export default function ProfileIsland() {
  const p = useStore(profile);
  return (
    <button id="profile-btn" className="topbar-btn" title="Your profile & setup" onClick={() => window.FinSight.store.setState({ setupOpen: true })}>
      ◐ <span id="profile-name">{firstName(p)}</span>
    </button>
  );
}
