import { getSkeletonWarriorRig } from '../../characters/skeletonWarrior';
import { createAnimatedNpcMesh } from '../../ecs/systems/npcAnimation';
import type { NpcArchetypeDef } from '../types';

const skeletonWarrior: NpcArchetypeDef = {
  id: 'skeleton-warrior',
  name: 'Skeleton Warrior',
  health: 30,
  behavior: 'aggressive',
  halfExtent: .35,
  aggroRange: 7,
  attackRange: 1.7,
  attackDamage: 9,
  attackReach: 1.15,
  attackCooldown: 1.3,
  agility: .25,
  weaponClass: 'oneHanded',
  chaseSpeed: 2.0,
  maxStamina: 80,
  createMesh: eid => createAnimatedNpcMesh(getSkeletonWarriorRig(), eid),
};

export default skeletonWarrior;
