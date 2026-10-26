---
name: "playwright"
description: "Use when the task requires automating a real browser from the terminal (navigation, form filling, snapshots, screenshots, data extraction, UI-flow debugging) via `playwright-cli` or the bundled wrapper script."
---


# Playwright CLI Skill

For terminal browser automation use `playwright-cli`. Prefer the project's
existing browser environment or connected browser tools when available. The
bundled wrapper is an optional CLI fallback; no global install is required.

## Prerequisite check (required)

Portable Game Studio Kit adaptation: first use an already connected browser
tool or the project's existing Playwright environment when it can perform the
test. The commands below describe the optional CLI path. On Windows, use
`Get-Command npx -ErrorAction SilentlyContinue` instead of `command -v`; if
Git Bash is unavailable, call `npx @playwright/cli ...` directly after checking
the current official CLI documentation. Do not make bash a requirement of the
game workflow. Missing CLI is a dependency report, not a reason to abandon
independent build or static checks. Record which runtime checks remain NOT_RUN.

Before proposing commands, check whether `npx` is available (the wrapper depends on it):

```bash
command -v npx >/dev/null 2>&1
```

If npx is unavailable, first try the available browser tools or an existing
project runtime. If CLI setup is actually required, report the missing
dependency and perform installation within the user's task scope, checking
current official setup instructions. Keep independent checks moving and mark
browser checks NOT_RUN until a browser can actually execute them. Once npx is
present, the wrapper is usable without a global install.

## Resolve the installed skill path

Resolve `scripts/playwright_cli.sh` relative to this SKILL.md, using its actual
installed path. This kit normally installs project skills in `.agents/skills`
and can install into an explicit user skill directory. Do not assume a
`~/.codex/skills` location. In a bash session set `PWCLI` to that resolved path;
in PowerShell without bash use the direct CLI as described above. Avoid changing
CODEX_HOME merely to locate a script.

## Quick start

Use the wrapper script:

```bash
bash "$PWCLI" open https://playwright.dev --headed
bash "$PWCLI" snapshot
bash "$PWCLI" click e15
bash "$PWCLI" type "Playwright"
bash "$PWCLI" press Enter
bash "$PWCLI" screenshot
```

If the user prefers a global install, this is also valid:

```bash
npm install -g @playwright/cli@latest
playwright-cli --help
```

## Core workflow

1. Open the page.
2. Snapshot to get stable element refs.
3. Interact using refs from the latest snapshot.
4. Re-snapshot after navigation or significant DOM changes.
5. Capture artifacts (screenshot, pdf, traces) when useful.

Minimal loop:

```bash
bash "$PWCLI" open https://example.com
bash "$PWCLI" snapshot
bash "$PWCLI" click e3
bash "$PWCLI" snapshot
```

## When to snapshot again

Snapshot again after:

- navigation
- clicking elements that change the UI substantially
- opening/closing modals or menus
- tab switches

Refs can go stale. When a command fails due to a missing ref, snapshot again.

## Recommended patterns

### Form fill and submit

```bash
bash "$PWCLI" open https://example.com/form
bash "$PWCLI" snapshot
bash "$PWCLI" fill e1 "user@example.com"
bash "$PWCLI" fill e2 "password123"
bash "$PWCLI" click e3
bash "$PWCLI" snapshot
```

### Debug a UI flow with traces

```bash
bash "$PWCLI" open https://example.com --headed
bash "$PWCLI" tracing-start
# ...interactions...
bash "$PWCLI" tracing-stop
```

### Multi-tab work

```bash
bash "$PWCLI" tab-new https://example.com
bash "$PWCLI" tab-list
bash "$PWCLI" tab-select 0
bash "$PWCLI" snapshot
```

## Wrapper script

The wrapper script uses `npx --package @playwright/cli playwright-cli` so the CLI can run without a global install:

```bash
bash "$PWCLI" --help
```

Prefer the wrapper unless the repository already standardizes on a global install.

## References

Open only what you need:

- CLI command reference: `references/cli.md`
- Practical workflows and troubleshooting: `references/workflows.md`

## Guardrails

- Always snapshot before referencing element ids like `e12`.
- Re-snapshot when refs seem stale.
- Prefer explicit commands over `eval` and `run-code` unless needed.
- When you do not have a fresh snapshot, use placeholder refs like `eX` and say why; do not bypass refs with `run-code`.
- Use `--headed` when a visual check will help.
- When capturing artifacts in this repo, use `output/playwright/` and avoid introducing new top-level artifact folders.
- Default to CLI commands and workflows, not Playwright test specs.

## Windows / PowerShell local installation

The bundled `.sh` wrapper needs Bash. In PowerShell, check `Get-Command npx.cmd`
and use the equivalent command directly:

```powershell
npx.cmd --yes --package @playwright/cli playwright-cli --help
```

Pass the same CLI arguments shown above. If `PLAYWRIGHT_CLI_SESSION` is set,
pass `--session $env:PLAYWRIGHT_CLI_SESSION` unless the command already specifies
a session. Keep project-specific output paths and the user's requested browser.
This skill's installation alone does not install the CLI or browser binaries.
