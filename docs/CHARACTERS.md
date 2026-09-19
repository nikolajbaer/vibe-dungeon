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
| combatIdle | Three-second crouched guard with the off-hand protecting the chest |
| attack | 1.7-second right-handed step-lunge, maximum extension around 0.62 s |
| parry | 0.9-second one-handed deflection crossing the weapon in front of the face |
| unarmedStrike | 1.25-second right cross from a high two-hand boxing guard |
| chop | 1.45-second overhead diagonal strike for a top-heavy axe or mace |

Pass `weapon: 'shortSword'` to attach a shortened sword to `hand.R`.
Pass `weapon: 'dagger'` for the compact blade used by the bandit. The bandit
switches to the crouched guard in attack range and plays `attack` on each hit.
The character viewer includes the weapon and both combat clips. The stab
returns to the crouched guard and has no root-motion translation. These new
combat clips are currently an animation preview: the NPC damage timing and
first-person player weapon behavior are not changed by this addition.

Open `/character.html` to orbit the model, switch species/clips, show bones,
or export an animated GLB. `npm run test:characters` validates all presets,
round-trips GLBs, and exercises real NPC animation state transitions.
Exports and render data are regenerated under `public/characters/` (ignored).
Optional offline GIFs: `python tests/render-humanoids.py` or append `--actions`,
`--attack`, or `--combat`;
this renderer requires NumPy, Pillow, and the DejaVu Sans system font.
