# Humanoid characters

The villager, quartermaster and bandit now use the same 1,580-triangle,
23-bone skinned humanoid. The bandit's existing tint and all NPC behavior,
dialogue and combat settings are preserved. Capsule height is adjusted to
the new human model's 1.79 m crown.

`createHumanoidRig({ species, skin, tunic, trousers })` builds a reusable rig.
Species are `human` (default), `elf`, `goblin`, and `dwarf`. Human, elf and
goblin have equal height; dwarf is shorter. Current NPCs remain human.
Changing a gameplay NPC to dwarf also requires matching its collision height.
Clone the mesh with `SkeletonUtils.clone`, never `mesh.clone`, so animated
instances do not share bones. UVs and vertex colors support reskinning;
hands have thumb bones but no individual fingers or facial animation rig.

Animation names deliberately retain the existing gameplay contract:

| Clip | Behavior |
| --- | --- |
| idle | Six-second loiter loop: breathing, relaxed arms and glances |
| walk | 1.1-second in-place walk with torso counter-rotation |
| hit | 0.75-second recoil and recovery; resumes locomotion |
| death | 2.4-second collapse and settle; held permanently until corpse cleanup |

Open `/character.html` to orbit the model, switch species/clips, show bones,
or export an animated GLB. `npm run test:characters` validates all presets,
round-trips GLBs, and exercises real NPC animation state transitions.
Exports and render data are regenerated under `public/characters/` (ignored).
Optional offline GIFs: `python tests/render-humanoids.py` or append `--actions`;
this renderer requires NumPy, Pillow, and the DejaVu Sans system font.
