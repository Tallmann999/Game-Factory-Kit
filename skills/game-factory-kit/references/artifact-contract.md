# Project artifact contract

Use this reference when creating a planning workspace, updating project documentation, or handing work to another agent.

## Canonical files

| File | Purpose |
| --- | --- |
| `PROJECT.md` | current status, constraints, Now/Next/Later boundary |
| `GAME_SPEC.yaml` | compact machine-readable project facts |
| `docs/GDD.md` | player fantasy, loop, rules, content, UX |
| `docs/TECHNICAL_DESIGN.md` | architecture evidence, runtime flow, integrations |
| `ROADMAP.md` | milestone outcomes and gates |
| `BACKLOG.md` | actionable slices with acceptance criteria |
| `QA.md` | automated and manual verification scenarios |
| `DECISIONS.md` | decisions, alternatives, and consequences |
| `HANDOFF.md` | last verified state and next action |

Use the smallest subset that serves the request. The initializer creates all files so a new project has a stable place for each kind of information.

## Update rules

- Prefer modifying the canonical file over creating `new`, `final`, `v2`, or agent-specific copies.
- Timestamp decisions and handoffs in ISO `YYYY-MM-DD` format.
- Keep facts separate from assumptions and unresolved questions.
- Link a task to its milestone and verification scenario when IDs exist.
- Record what was actually verified; do not promote intended tests to completed evidence.
- Preserve user wording for the fantasy and product promise when it is deliberate.

## Handoff minimum

```markdown
## Last verified state
- ...

## Changed
- ...

## Decisions and assumptions
- ...

## Remaining checks
- ...

## Next recommended action
- ...

## Blockers / out of scope
- ...
```
