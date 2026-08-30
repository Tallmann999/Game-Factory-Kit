---
name: game-factory-kit
description: Turn a game idea or an existing game repository into a deliberately scoped, playable, testable project. Use for game concept definition, prototype planning, milestone breakdown, implementation, gameplay iteration, QA, or agent handoff; do not use for isolated art generation or general programming unrelated to a game project.
---

# Game Factory Kit

Move the game toward the next observable playable result. Match the depth of work to the user's request: a focused implementation request does not require regenerating the entire design package.

## Establish the working state

Identify these facts from the conversation and repository before acting:

- player fantasy and core loop;
- target platform, engine, input, and session length;
- current maturity: idea, spike, prototype, vertical slice, demo, or release;
- existing assets, code, constraints, and the next decision or milestone;
- evidence that will prove the requested result works.

Ask only for missing information that would materially change the result. Ask no more than three focused questions at once and provide a recommended default where reasonable. If the user authorizes implementation and the repository supplies enough evidence, inspect it and proceed.

For a new planning workspace, run `scripts/init_game_project.py`. Treat its generated documents as a compact source of truth, not paperwork that must all be completed before useful work begins.

## Choose the smallest useful mode

1. **Discover** — clarify fantasy, audience, references, constraints, and risks.
2. **Define** — lock the core loop, controls, success/failure, and deliberately excluded scope.
3. **Plan** — create a milestone with a playable outcome, tasks, dependencies, and acceptance checks.
4. **Build** — implement a thin vertical path through the loop, following the existing repository's conventions.
5. **Verify** — run relevant checks and playtest the behavior against observable acceptance criteria.
6. **Release** — prepare platform integration, build instructions, store/demo requirements, and known limitations.

Enter at the mode the request requires. Do not force completed work back through earlier modes.

## Control scope

- Protect the core loop before meta progression, content volume, polish, or monetization.
- Prefer one complete playable slice over several disconnected systems.
- Keep a `Now / Next / Later / Not in this version` boundary when scope is at risk.
- Convert subjective goals such as “feels impactful” into observable signals and a playtest question.
- Mark assumptions explicitly. Do not silently invent audience, business model, art budget, or technical constraints.
- Do not claim “any engine” support from generic guidance. State which route is verified and which is provisional.

Read [scope-control.md](references/scope-control.md) when choosing MVP contents or cutting a milestone.

## Produce implementation-ready work

For each feature or task, include only the fields that improve execution:

- player-visible outcome;
- current evidence and affected systems;
- implementation notes and dependencies;
- acceptance criteria that can be observed or tested;
- explicit exclusions;
- risks or unknowns that require a spike.

Keep design intent separate from implementation details. When changing code, first inspect the project structure, engine version, dependency files, existing architecture, and working-tree state. Preserve user changes and established conventions. Reuse the project's tooling and assets when possible.

Read [engine-routing.md](references/engine-routing.md) for Unity/C#, browser, and provisional engine routes. Read [artifact-contract.md](references/artifact-contract.md) when creating or updating project documents or handing work to another agent.

## Verify the result

Select checks proportional to the change:

- static validation, compilation, and automated tests where available;
- a minimal launch/build check for the target platform;
- a focused gameplay scenario with expected observations;
- regression checks for input, save data, pooling/lifecycle, scene transitions, and performance when affected.

Never equate successful compilation with a successful game feature. If direct playtesting is unavailable, say what was verified automatically and give the shortest manual test still required.

Read [quality-gates.md](references/quality-gates.md) when closing a milestone or preparing a build. Run `scripts/validate_game_project.py <project-path>` to check a generated planning workspace.

## Maintain continuity

At the end of substantial work, leave a concise handoff containing:

- completed and verified;
- changed files or systems;
- decisions and assumptions;
- remaining manual checks;
- next recommended action;
- known blockers and out-of-scope work.

Update existing project documents instead of creating parallel sources of truth. Avoid external publishing, account changes, purchases, messages, or destructive repository actions unless the user explicitly authorizes them.
