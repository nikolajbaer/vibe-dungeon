import * as THREE from "three";
import { hasComponent, removeComponent, type World } from "bitecs";
import { Combat, Dead, DeathSector, Health, NPC, NpcState, Object3DRef, PhysicsBody, Position, Velocity } from "../ecs/components";
import type { Physics } from "../physics/world";
import { spawnNpcs } from "../level/spawning";
import { mountOpponentConfigurator, openOpponentConfigurator } from "./mount";
import type { OpponentConfig, OpponentWeapon } from "./OpponentConfigurator";

export { buildCombatTestLevel } from "../level/combatTestLevel";

/** The combat-test sandbox drops the normal carry-weight cap (`BASE_CARRY_WEIGHT`
 * in ecs/systems/items.ts) so testing can freely swap through every weapon the
 * opponent configurator offers without inventory-weight limits getting in the way. */
export const COMBAT_TEST_CARRY_WEIGHT = 100;

const ARCHETYPE_FOR_WEAPON: Record<OpponentWeapon, string> = {
  unarmed: "villager",
  dagger: "bandit",
  sword: "guard",
  wooden_sword: "weapons-master",
};

/** The distinct game mode `game.ts` boots into when started with
 * `mode: "combat-test"` (see `mountOpponentConfigurator`/`OpponentConfigurator`):
 * a flat sparring mat where stepping onto it opens a panel to configure and
 * spawn a single practice opponent, defeats never end the session (the
 * player is immediately restored so testing can continue), and a defeated
 * opponent's corpse sticks around briefly for inspection before clearing
 * itself. None of this exists in the real dungeon, so it's kept out of
 * `game.ts`'s core loop entirely -- `startGame` just owns one instance of
 * this class when `gameMode === "combat-test"` and calls `mount`/`update`. */
export class CombatTestSandbox {
  /** Whether the opponent-configurator panel is currently open -- folded
   * into `game.ts`'s `isModalActive()` the same way dialogue/notice/container
   * panels are, since the sim shouldn't keep running while it's up. */
  combatConfigOpen = false;
  private activeOpponentEid: number | undefined;
  private opponentDeathTime = 0;
  /** Debounces the test-mat trigger with hysteresis (armed again only once
   * the player has stepped well clear of the mat) so standing right at its
   * edge can't repeatedly reopen the panel from tiny character-controller
   * position jitter. */
  private testMatTriggerArmed = true;

  constructor(private world: World, private physics: Physics, private scene: THREE.Scene, private playerEid: number) {}

  mount(container: HTMLElement): void {
    mountOpponentConfigurator(container, this.spawnOpponent, (open) => { this.combatConfigOpen = open; });
  }

  private removeOpponent = (eid: number): void => {
    Object3DRef[eid]?.removeFromParent();
    PhysicsBody[eid]?.setEnabled(false);
    DeathSector.sectorId[eid] = undefined;
    NPC.testStyle[eid] = undefined;
    if (hasComponent(this.world, eid, NPC)) removeComponent(this.world, eid, NPC);
    if (this.activeOpponentEid === eid) this.activeOpponentEid = undefined;
  };

  private spawnOpponent = (config: OpponentConfig): void => {
    if (this.activeOpponentEid !== undefined) this.removeOpponent(this.activeOpponentEid);
    const [eid] = spawnNpcs(this.world, this.physics, this.scene, [{ id: ARCHETYPE_FOR_WEAPON[config.weapon], x: 0, z: -2 }]);
    this.activeOpponentEid = eid;
    this.opponentDeathTime = 0;
    Health.current[eid] = config.health;
    Health.max[eid] = config.health;
    NPC.moveSpeed[eid] = config.speed;
    NPC.testStyle[eid] = config.style;
    NPC.provocationHits[eid] = config.style === "defensive" ? 1 : 0;
    NPC.provoked[eid] = config.style === "aggressive" ? 1 : 0;
    Combat.agility[eid] = config.style === "defensive" ? 0.7 : config.style === "aggressive" ? 0.2 : 0;
  };

  /** Called once per rendered frame from `game.ts`'s `frame()`, mirroring
   * where the equivalent logic used to live inline. */
  update(dt: number): void {
    const player = this.playerEid;
    const onTestMat = Math.abs(Position.x[player]) <= 9 && Math.abs(Position.z[player]) <= 9;
    if (onTestMat && this.testMatTriggerArmed) {
      this.testMatTriggerArmed = false;
      openOpponentConfigurator();
    }
    const clearedTestMat = Math.abs(Position.x[player]) >= 9.5 || Math.abs(Position.z[player]) >= 9.5;
    if (clearedTestMat) this.testMatTriggerArmed = true;

    // Combat test defeats are non-terminal: stop the opponent, restore the
    // player immediately, and leave the opponent available for inspection.
    if (Health.current[player] <= 0 || hasComponent(this.world, player, Dead)) {
      Health.current[player] = Health.max[player];
      if (hasComponent(this.world, player, Dead)) removeComponent(this.world, player, Dead);
      if (this.activeOpponentEid !== undefined && hasComponent(this.world, this.activeOpponentEid, NPC)) {
        NPC.testStyle[this.activeOpponentEid] = "passive";
        NPC.provoked[this.activeOpponentEid] = 0;
        NPC.state[this.activeOpponentEid] = NpcState.LOITERING;
        Velocity.x[this.activeOpponentEid] = 0;
        Velocity.z[this.activeOpponentEid] = 0;
      }
    }
    if (this.activeOpponentEid !== undefined && hasComponent(this.world, this.activeOpponentEid, Dead)) {
      this.opponentDeathTime += dt;
      if (this.opponentDeathTime >= 5) this.removeOpponent(this.activeOpponentEid);
    }
  }
}
