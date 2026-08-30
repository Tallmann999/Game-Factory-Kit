# {{TITLE}} — Verification

## Automated checks

No implementation repository has been inspected. Add exact commands and results when available.

## Manual scenario — complete core loop

Given a fresh launch:

1. start the playable experience;
2. perform the primary action;
3. observe readable feedback and state change;
4. reach success or failure;
5. restart without stale state or a blocker.

Expected: each step is understandable and completes without developer intervention.

Status: not run.

## Regression checklist

- input remains responsive after restart;
- gameplay entities and timers do not duplicate;
- win/fail state prevents unintended continued play;
- audio, focus, resolution, and persistence checks are added when applicable.

## Known limitations

- Target hardware and build route are undecided.
