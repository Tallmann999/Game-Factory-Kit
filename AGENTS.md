# Repository guidance for agents

This repository packages an installable Codex skill. Keep the skill useful, compact, and honest about verified support.

## Source of truth

- `skills/game-factory-kit/SKILL.md` contains shared operating guidance.
- `references/` contains conditional detail and must be linked from `SKILL.md`.
- `assets/project-template/` contains files copied into a new game workspace.
- `scripts/` contains deterministic reusable behavior and must remain dependency-free unless a dependency is justified and documented.

## Change rules

- Preserve progressive disclosure; do not move every reference into `SKILL.md`.
- Do not claim engine or platform support without a tested route.
- Add a template only when it has one canonical purpose.
- Keep initializer output compatible with the validator.
- Do not overwrite existing game workspaces.
- Update the example and tests when changing the artifact contract.
- Record user-visible changes in `CHANGELOG.md`.

## Verification

Run:

```bash
python3 -m unittest discover -s tests -v
python3 skills/game-factory-kit/scripts/validate_game_project.py examples/mage-cleanse-corruption
```

When the Codex skill-creator utilities are available, also run `quick_validate.py` against `skills/game-factory-kit`.
