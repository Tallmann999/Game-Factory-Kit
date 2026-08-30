# Quality gates

Use this reference when closing a milestone, evaluating a build, or preparing a demo/release.

## Prototype gate

- starts through a documented route;
- player can complete the core loop and restart;
- primary state and success/failure are readable;
- no known blocker prevents the intended test;
- placeholder content and deliberate omissions are labeled.

## Vertical-slice gate

- one path represents target presentation and interaction quality;
- code and content pipeline are repeatable enough for production;
- performance is measured on a relevant target;
- asset and plugin sources are recorded;
- major production risks have evidence or a planned spike.

## Demo gate

- a new player can begin without developer assistance;
- the build survives repeated start, play, fail/win, and restart cycles;
- save/progression behavior is explicit and recoverable where applicable;
- controls, audio, resolution, pause/focus, and exit behavior fit the platform;
- feedback collection, version identity, and known issues are ready.

## Verification report

Report checks in three groups:

1. **Passed automatically** — commands and meaningful results.
2. **Observed manually** — scenario, device/build, and observation.
3. **Still required** — shortest remaining check and why it could not be run.

Never write “fully tested” without defining the covered surface.
