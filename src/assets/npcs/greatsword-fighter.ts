import type { NpcArchetypeDef } from '../types';
import { createTwoHandedNpcMesh } from '../../ecs/systems/twoHandedNpcAnimation';
const def:NpcArchetypeDef={id:'greatsword-fighter',name:'Greatsword fighter',health:60,behavior:'docile',halfExtent:.4,weaponClass:'twoHanded',maxStamina:100,attackRange:1.8,attackReach:1.8,attackDamage:15,attackCooldown:2.3,createMesh:eid=>createTwoHandedNpcMesh('greatsword',eid)};
export default def;
