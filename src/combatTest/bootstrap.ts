import * as THREE from "three";
import { hasComponent, removeComponent, type World } from "bitecs";
import { Combat, Dead, DeathSector, Health, NPC, NpcState, Object3DRef, PhysicsBody, PhysicsCollider, Velocity } from "../ecs/components";
import { CHARACTER_GROUPS, type Physics } from "../physics/world";
import { spawnNpcs } from "../level/spawning";
import { mountOpponentConfigurator } from "./mount";
import type { OpponentConfig, OpponentWeapon } from "./OpponentConfigurator";

export { buildCombatTestLevel } from "../level/combatTestLevel";

/** The combat-test sandbox drops the normal carry-weight cap (`BASE_CARRY_WEIGHT`
 * in ecs/systems/items.ts) so testing can freely swap through every weapon the
 * opponent configurator offers without inventory-weight limits getting in the way. */
export const COMBAT_TEST_CARRY_WEIGHT = 100;

const ARCHETYPE_FOR_WEAPON: Record<Exclude<OpponentWeapon, "random">, string> = {
  unarmed: "villager",
  dagger: "bandit",
  sword: "guard",
  wooden_sword: "weapons-master",
  quarterstaff: "quarterstaff-fighter",
  greatsword: "greatsword-fighter",
  dagger_javelin: "javelin-fighter",
  crossbow: "crossbow-fighter",
};
const RANDOM_WEAPONS = ["dagger_javelin", "crossbow", "quarterstaff"] as const;
export function opponentArchetype(weapon: OpponentWeapon, random = Math.random): string {
  const selected = weapon === "random" ? RANDOM_WEAPONS[Math.floor(random() * RANDOM_WEAPONS.length)] : weapon;
  return ARCHETYPE_FOR_WEAPON[selected];
}

/** Meters between adjacent opponents in the same spawned batch -- more than
 * twice any archetype's capsule radius (the widest, `guard`/`weapons-master`,
 * is 0.4m), so a freshly-spawned row never starts already overlapping now
 * that characters are solid to each other (physics/world.ts's
 * `CHARACTER_GROUPS`). */
const OPPONENT_ROW_SPACING = 1.3;

/** How many seconds a corpse (or a whole defeated batch of them) lingers
 * for inspection before `removeOpponent` clears it -- unchanged from the
 * single-opponent version of this sandbox. */
const CORPSE_LINGER_SECONDS = 5;

/** The distinct game mode `game.ts` boots into when started with
 * `mode: "combat-test"` (see `mountOpponentConfigurator`/`OpponentConfigurator`):
 * a flat sparring mat, its own "Configure opponent" button (always on
 * screen, `OpponentConfigurator.tsx`) opening a panel to configure and
 * spawn one or more practice opponents, defeats never end the session (the
 * player is immediately restored so testing can continue), and a defeated
 * batch's corpses stick around briefly for inspection before clearing
 * themselves. None of this exists in the real dungeon, so it's kept out of
 * `game.ts`'s core loop entirely -- `startGame` just owns one instance of
 * this class when `gameMode === "combat-test"` and calls `mount`/`update`.
 *
 * Opponents are tracked per `NPC.team` (`OpponentConfig.team`): spawning a
 * team replaces that team's own previous batch (so re-configuring "Team 1"
 * clears the old Team 1 without touching a separately-spawned Team 2), and
 * two different teams are hostile to each other (`meleeCollision.ts`'s
 * `isHostileTo`) exactly the same way either one is hostile to the player --
 * letting the opponent configurator build actual NPC-vs-NPC battles just by
 * spawning more than one team.
 */
export class CombatTestSandbox {
  /** Whether the opponent-configurator panel is currently open -- folded
   * into `game.ts`'s `isModalActive()` the same way dialogue/notice/container
   * panels are, since the sim shouldn't keep running while it's up. */
  combatConfigOpen = false;
  private opponentsByTeam = new Map<number, number[]>();
  /** `undefined` until every tracked opponent (across every team) is dead
   * at once -- the instant that first becomes true, the player's health is
   * restored (see `update` below) and this starts counting up to
   * `CORPSE_LINGER_SECONDS`. Reset back to `undefined` by any new spawn,
   * since that always means the bout isn't won yet. */
  private allDefeatedTime: number | undefined;

  constructor(private world: World, private physics: Physics, private scene: THREE.Scene, private playerEid: number) {}

  mount(container: HTMLElement): void {
    mountOpponentConfigurator(container, this.spawnOpponent, (open) => { this.combatConfigOpen = open; });
  }

  private allOpponents(): number[] {
    return Array.from(this.opponentsByTeam.values()).flat();
  }

  private removeOpponent = (eid: number): void => {
    Object3DRef[eid]?.removeFromParent();
    PhysicsBody[eid]?.setEnabled(false);
    DeathSector.sectorId[eid] = undefined;
    NPC.testStyle[eid] = undefined;
    if (hasComponent(this.world, eid, NPC)) removeComponent(this.world, eid, NPC);
  };

  private clearTeam(team: number): void {
    for (const eid of this.opponentsByTeam.get(team) ?? []) this.removeOpponent(eid);
    this.opponentsByTeam.delete(team);
  }

  private spawnOpponent = (config: OpponentConfig): void => {
    this.clearTeam(config.team);
    // Each team gets its own row, `OPPONENT_ROW_SPACING` further from the
    // player per team so a second/third team never spawns on top of the
    // first regardless of how many opponents either batch has.
    const rowZ = -2 - (config.team - 1) * 3;
    const placements = Array.from({ length: config.count }, (_, i) => {
      const id = opponentArchetype(config.weapon);
      return {
        id, x: (i - (config.count - 1) / 2) * OPPONENT_ROW_SPACING, z: rowZ,
        contents: id === "javelin-fighter" ? ["dagger", "javelin"] : id === "crossbow-fighter" ? ["crossbow"] : undefined,
      };
    });
    const eids = spawnNpcs(this.world, this.physics, this.scene, placements);
    for (const eid of eids) {
      Health.current[eid] = config.health;
      Health.max[eid] = config.health;
      NPC.moveSpeed[eid] = config.speed;
      NPC.testStyle[eid] = config.style;
      NPC.provocationHits[eid] = config.style === "defensive" ? 1 : 0;
      NPC.provoked[eid] = config.style === "aggressive" ? 1 : 0;
      NPC.team[eid] = config.team;
      Combat.agility[eid] = config.style === "defensive" ? 0.7 : config.style === "aggressive" ? 0.2 : 0;
    }
    this.opponentsByTeam.set(config.team, eids);
    this.allDefeatedTime = undefined; // a fresh spawn always means the bout isn't won yet
  };

  /** Called once per rendered frame from `game.ts`'s `frame()`, mirroring
   * where the equivalent logic used to live inline. */
  update(dt: number): void {
    const player = this.playerEid;

    // Combat test defeats are non-terminal: stop every opponent, restore
    // the player immediately, and leave the opponents available for inspection.
    if (Health.current[player] <= 0 || hasComponent(this.world, player, Dead)) {
      Health.current[player] = Health.max[player];
      if (hasComponent(this.world, player, Dead)) {
        removeComponent(this.world, player, Dead);
        // combat.ts's disableCorpseCollision zeroed this on death (so a
        // corpse doesn't block traffic) -- a non-terminal defeat is the one
        // place a "dead" combatant comes right back to fighting, so it's
        // the one place that needs undoing outside game.ts's own respawn.
        PhysicsCollider[player]?.setCollisionGroups(CHARACTER_GROUPS);
      }
      for (const eid of this.allOpponents()) {
        if (!hasComponent(this.world, eid, NPC)) continue;
        NPC.testStyle[eid] = "passive";
        NPC.provoked[eid] = 0;
        NPC.state[eid] = NpcState.LOITERING;
        Velocity.x[eid] = 0;
        Velocity.z[eid] = 0;
      }
    }

    const opponents = this.allOpponents();
    const allDead = opponents.length > 0 && opponents.every((eid) => hasComponent(this.world, eid, Dead));
    if (allDead) {
      if (this.allDefeatedTime === undefined) {
        // The instant every opponent is down (whichever team, however many
        // there were), the bout is won -- restore the player right away
        // rather than making them wait through the corpse-linger window
        // below just to keep testing.
        this.allDefeatedTime = 0;
        Health.current[player] = Health.max[player];
      } else {
        this.allDefeatedTime += dt;
        if (this.allDefeatedTime >= CORPSE_LINGER_SECONDS) {
          for (const eid of opponents) this.removeOpponent(eid);
          this.opponentsByTeam.clear();
          this.allDefeatedTime = undefined;
        }
      }
    }
  }
}
