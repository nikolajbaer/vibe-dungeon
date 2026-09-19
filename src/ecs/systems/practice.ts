import { addComponent, hasComponent, query, type World } from "bitecs";
import { Combat, NPC, NpcState, PlayerControlled, Position, Practice, Velocity } from "../components";

export const PRACTICE_POINTS = 30;

export interface PracticeResult {
  masterEid: number;
  playerWon: boolean;
  remainingFraction: number;
}

export function startPractice(world: World, masterEid: number, masterAgility: number): boolean {
  const playerEid = query(world, [PlayerControlled])[0];
  if (playerEid === undefined || !hasComponent(world, masterEid, NPC)) return false;
  for (const eid of [playerEid, masterEid]) {
    if (!hasComponent(world, eid, Practice)) addComponent(world, eid, Practice);
    Practice.active[eid] = 1;
    Practice.points[eid] = PRACTICE_POINTS;
    Practice.maxPoints[eid] = PRACTICE_POINTS;
  }
  Practice.opponentEid[playerEid] = masterEid;
  Practice.opponentEid[masterEid] = playerEid;
  Combat.agility[masterEid] = Math.max(0, Math.min(1, masterAgility));
  NPC.state[masterEid] = NpcState.CHASING;
  NPC.attackCooldownRemaining[masterEid] = .5;
  return true;
}

/** Ends a bout exactly once when either score reaches zero. */
export function practiceSystem(world: World): PracticeResult | undefined {
  const playerEid = query(world, [PlayerControlled, Practice])[0];
  if (playerEid === undefined || !Practice.active[playerEid]) return undefined;
  const masterEid = Practice.opponentEid[playerEid];
  if (!hasComponent(world, masterEid, Practice) || !Practice.active[masterEid]) return undefined;
  if (Practice.points[playerEid] > 0 && Practice.points[masterEid] > 0) return undefined;

  const playerWon = Practice.points[masterEid] <= 0;
  const winnerEid = playerWon ? playerEid : masterEid;
  const remainingFraction = Practice.points[winnerEid] / Practice.maxPoints[winnerEid];
  Practice.active[playerEid] = 0;
  Practice.active[masterEid] = 0;
  Combat.agility[masterEid] = 0;
  NPC.state[masterEid] = NpcState.LOITERING;
  NPC.homeX[masterEid] = Position.x[masterEid];
  NPC.homeZ[masterEid] = Position.z[masterEid];
  Velocity.x[masterEid] = 0;
  Velocity.z[masterEid] = 0;
  return { masterEid, playerWon, remainingFraction };
}
