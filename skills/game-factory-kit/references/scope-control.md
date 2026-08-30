# Scope control

Use this reference when defining an MVP, estimating a solo project, or reducing an overloaded milestone.

## Scope ladder

- **Spike:** proves one unknown; disposable is acceptable.
- **Prototype:** proves the complete loop; placeholder presentation is acceptable.
- **Vertical slice:** proves representative production quality for one path.
- **Demo:** proves public comprehension, stability, and desire to continue.
- **Release:** proves the whole commercial or distribution promise.

Do not call a prototype a vertical slice merely because it is playable.

## Four-bucket boundary

Maintain these buckets when planning:

- **Now:** required for the current playable outcome.
- **Next:** likely follow-up after evidence from Now.
- **Later:** valuable, but does not influence the current test.
- **Not in this version:** explicitly excluded to prevent silent expansion.

## Feature test

A feature belongs in the current milestone only if at least one is true:

- the core loop cannot complete without it;
- the milestone's hypothesis cannot be tested without it;
- it removes a blocker for a required target build;
- it is the cheapest way to make critical state understandable.

Otherwise move it to Next or Later.

## Estimation

Estimate by uncertainty and verification cost, not by file count. Separate:

- known implementation;
- integration with existing systems;
- content production;
- polish and tuning;
- platform/build work;
- unresolved spikes.

For solo or AI-assisted work, do not treat generated code as finished work. Budget for inspection, integration, playtesting, regression fixes, and asset licensing.

## Definition of done template

```markdown
Outcome: A player can ...
Scenario: Given ... when ... then ...
Readable signals: ...
Automated evidence: ...
Manual playtest: ...
Out of scope: ...
Known limitation: ...
```
