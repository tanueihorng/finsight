# Documentation map

Start with [AGENTS.md](../AGENTS.md) for coding instructions. Load the documents relevant to the task.

| Need | Start here |
|---|---|
| Run or use FinSight | [README](../README.md), [setup entrypoint](../START-HERE.md) |
| Find a product requirement | [Product backlog](BACKLOG.md), then its linked feature spec |
| Understand the current code | [System overview](architecture/SYSTEM.md), [developer/API reference](../DOCS.md) |
| Change Kestrel | [Agent specification](../agent/docs/SPEC.md), [agent setup](../agent/README.md) |
| Understand product intent | [PRD](product/PRD.md) |
| Check the trade authority boundary | [ADR-001](decisions/ADR-001-trade-execution-boundary.md) |
| Check integrated changes | [Changelog](../CHANGELOG.md) and Git history |

The backlog owns requirements. When this checkout is inside the investment workspace, its
`harness/queue.json` owns scheduling, blockers and verified task completion; `harness/STATE.md`
identifies the active checkout and handoff. These workspace files are not required to use a standalone clone.
A backlog idea or checkbox does not authorize implementation, a provider call or deployment.

Architecture illustrations in [terminal overview](architecture/finsight-architecture.md) and
[agent overview](architecture/kestrel-architecture.md) are supporting reference material. The source,
agent specification and SYSTEM overview take precedence over an outdated diagram.

Historical setup/developer documents and the superseded changelog draft are retained in `archive/`.
They describe earlier states and do not override current instructions.
