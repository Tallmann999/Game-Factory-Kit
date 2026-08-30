# Engine routing

Read only the route relevant to the current project. The kit's verified starter routes are Unity/C# and browser games. Other routes are planning-compatible but must be adapted to the inspected project.

## Shared rules

- Inspect engine/runtime versions and dependency manifests before changing code.
- Follow existing folder, naming, scene, prefab/entity, input, and save conventions.
- Separate pure game rules from engine presentation when that reduces test cost.
- Prefer data-driven configuration for tunable content, but avoid premature frameworks.
- Treat imported assets, fonts, music, plugins, and models as licensed dependencies.
- Verify on the actual target platform or document the remaining platform check.

## Unity and C#

Inspect `ProjectVersion.txt`, package manifests, assembly definitions, scenes, prefabs, ScriptableObjects, and Input System configuration. Determine whether the project uses 2D, 3D, URP/HDRP, ECS, or classic GameObjects from evidence.

When implementing:

- avoid adding a new architecture when the current one can safely host the feature;
- keep `MonoBehaviour` lifecycle, object destruction, pooling, scene changes, and serialization in mind;
- preserve serialized field names or use migration attributes when renaming matters;
- test domain reload, play-mode restart, scene reload, and pooled object reuse when affected;
- never edit generated Unity folders such as `Library`, `Temp`, or `Obj` as source.

Prefer EditMode tests for pure rules and focused PlayMode tests for engine behavior. A compile check does not replace playtesting animation, physics, camera, input feel, VFX readability, or build behavior.

## Browser games

Inspect package manifests, build scripts, browser targets, asset loading, state persistence, and hosting constraints. Determine whether the project is vanilla HTML/CSS/JS, Canvas, WebGL, Phaser, PixiJS, React, or another framework from evidence.

When implementing:

- make the prototype start with one documented command;
- keep the loop playable with mouse/touch/keyboard appropriate to the target;
- avoid unbounded animation loops, event listeners, timers, or spawned entities;
- handle resize, focus loss, audio start restrictions, and persistence when relevant;
- optimize network and decoded asset size for web distribution.

Verify the production build, console errors, a fresh session, restart behavior, and at least the main target viewport.

## Godot, Unreal, and custom engines

Use the shared planning artifacts, but treat implementation guidance as provisional until the repository has been inspected. State the engine-specific validation route and do not invent editor, build, asset, or plugin behavior.
