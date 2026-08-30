# Delivery workflow

Use this reference when the user asks for an end-to-end game creation process or the next milestone is unclear.

## State model

| State | Useful output | Exit evidence |
| --- | --- | --- |
| Idea | one-sentence fantasy, audience, constraints | the player action and desired feeling are explicit |
| Spike | smallest experiment around the riskiest unknown | evidence supports or rejects the approach |
| Prototype | complete core loop with temporary content | a player can start, act, win or fail, and restart |
| Vertical slice | representative quality in one thin path | target art, audio, feedback, and technical direction coexist |
| Demo | bounded public experience | onboarding, stability, build, and feedback collection are ready |
| Release | shippable product | platform, save, performance, compliance, and store gates pass |

## Operating loop

1. State the current playable behavior, not only the feature inventory.
2. Choose one player-visible outcome for the milestone.
3. Identify the largest unknown; spike it before committing to broad production.
4. Break work into independently verifiable slices.
5. Implement the thinnest complete path.
6. Verify with automated evidence plus a focused playtest.
7. Record decisions and choose the next bottleneck.

## Product questions

Use only the questions that change the work:

- What does the player repeatedly do?
- Why is the next repetition meaningfully different?
- What creates tension, choice, mastery, surprise, or expression?
- How does the player understand success, failure, damage, rewards, and progression?
- What must be true in the first minute for the concept to be legible?
- What is deliberately absent from this version?

## Build order for a new prototype

Prefer this dependency shape, adapted to the game:

1. boot and restart;
2. input and primary action;
3. target or opposing rule;
4. feedback and readable state;
5. win/fail condition;
6. one meaningful decision or variation;
7. only then add content breadth and polish.

Do not interpret this as a universal file or class architecture.
