# FEAT-003: Kestrel Chat Session Deletion & Management

- **ID:** FEAT-003
- **Status:** Selected; isolated implementation owned by existing feature session
- **Execution task:** `CHATDELETE-001`
- **Priority:** High
- **Category:** UX / Agent Panel

---

## 1. Summary
Streamline chat session deletion in Kestrel. While backend deletion (`DELETE /v1/threads/:id?confirm=true`) and sidebar rail deletion already exist, the user must currently expand the collapsed sidebar rail to delete a chat. This feature exposes quick, intuitive deletion controls across the interface.

---

## 2. Requirements & Acceptance Criteria

### A. Active Chat Header Deletion
- [ ] Add a Delete button (trash icon `🗑`) to `agent-head-tools` in [KestrelIsland.tsx](../../web/src/features/kestrel/KestrelIsland.tsx) when an active chat thread is displayed.
- [ ] Clicking the icon triggers the existing confirmation modal: *"Delete '<title>'? This chat is deleted permanently."*
- [ ] On confirmation, dispatches `deleteThread(t)`, navigates to `newChat()`, and updates the threads list.

### B. Start Screen Jump List Deletion
- [ ] Add a hover/focus action or right-click context menu on the `.kx-jump-row` buttons on Kestrel’s start screen.
- [ ] Allows deleting historical threads directly from the start screen without opening them first.

### C. Composer Slash Commands
- [ ] Support `/delete` in the composer to delete the currently active thread (with modal confirmation).
- [ ] Support `/clear` to start a fresh chat or wipe thread history.

### D. Bulk Deletion
- [ ] Add a "Clear all chats" option inside the `Rail` (chats sidebar) behind a two-step confirmation modal.
