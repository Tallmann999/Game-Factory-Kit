# Contributing

Keep contributions small enough to validate against a real game-development request.

1. Describe the user request or failure the change addresses.
2. Modify the narrowest instruction, reference, script, or template that solves it.
3. Add or update a meaningful test when deterministic behavior changes.
4. Run the repository tests and validate the example workspace.
5. Update `CHANGELOG.md` when behavior visible to users or agents changes.

Avoid generic advice, duplicated checklists, speculative engine rules, and templates without a clear owner. A new engine adapter should include an inspection route, implementation constraints, and a build/playtest validation route proven on at least one representative project.
