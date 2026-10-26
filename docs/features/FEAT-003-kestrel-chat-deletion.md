# FEAT-003: Kestrel Chat Session Deletion & Management

- **ID:** FEAT-003
- Status: Implemented and verified; committed in `22b0436`, integration selected 2026-10-27.
- **Execution task:** `CHATDELETE-001`
- **Priority:** High
- **Category:** UX / Agent Panel

---

## 1. Summary
Streamline chat session deletion in Kestrel. While backend deletion (`DELETE /v1/threads/:id?confirm=true`) and sidebar rail deletion already exist, the user must currently expand the collapsed sidebar rail to delete a chat. This feature exposes quick, intuitive deletion controls across the interface.

---

## 2. Requirements & Acceptance Criteria

### A. Active Chat Header Deletion
- [x] Add a Delete button (trash icon `🗑`) to `agent-head-tools` in [KestrelIsland.tsx](../../web/src/features/kestrel/KestrelIsland.tsx) when an active chat thread is displayed.
- [x] Clicking the icon triggers the existing confirmation modal: *"Delete '<title>'? This chat is deleted permanently."*
- [x] On confirmation, dispatches `deleteThread(t)`, navigates to `newChat()`, and updates the threads list.

### B. Start Screen Jump List Deletion
- [x] Add a hover/focus action or right-click context menu on the `.kx-jump-row` buttons on Kestrel’s start screen.
- [x] Allows deleting historical threads directly from the start screen without opening them first.

### C. Composer Slash Commands
- [x] Support `/delete` in the composer to delete the currently active thread (with modal confirmation).
- [x] Support `/clear` to start a fresh chat or wipe thread history.

### D. Bulk Deletion
- [x] Add a "Clear all chats" option inside the `Rail` (chats sidebar) behind a two-step confirmation modal.


Implementation: `/clear` preserves history; `/delete` confirms permanent deletion. Header/recent/rail controls and two-confirmation bulk deletion are verified. Bulk deletion checks the confirmed ID snapshot, includes archived/unpaginated chats and rejects running replies. Trace content is purged; uploads and operational logs retain existing retention. Rail deletion reserves space beside the date on hover/focus.
