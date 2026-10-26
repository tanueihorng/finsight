# Changelog

All notable changes to the FinSight project and Kestrel research agent will be documented in this file.
Format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]
### Added
- Centralized Docs-as-Code backlog and specification hierarchy (`docs/BACKLOG.md`, `docs/features/`, `docs/decisions/`).
- Architectural Decision Record on trade execution boundaries (`docs/decisions/ADR-001-trade-execution-boundary.md`).
- Backlog specifications for IBKR MCP Integration (`FEAT-001`), Investment Council Mode (`FEAT-002`), and Chat Deletion (`FEAT-003`).

---

## [0.3.0] - 2026-10-26
### Added
- **Intelligent UI Views:** Interactive card grids and sortable data tables (`render_ui`) for DeepSeek and OpenAI Responses models.
- **Start Screen Briefing:** Live intraday charts, top mover cards, next event countdowns, and keyboard-driven jump list.
- **Thinking Effort Slider:** Compact slider in composer row for controlling reasoning levels on supported models.

---

## [0.2.0] - 2026-10-24
### Added
- **Kestrel Research Agent:** Supervised, model-agnostic assistant inside FinSight terminal.
- 35 facts, records, strategies, and web research tools.
- Skills framework with initial bundled playbooks (`pre-trade-check`, `position-review`, `earnings-review`, `why-did-it-move`, `strategy-scan`).
- Three-tier memory architecture (Facts, Knowledge Markdown, SQLite FTS5 episodic memory).
