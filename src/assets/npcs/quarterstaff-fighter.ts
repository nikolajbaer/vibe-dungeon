import type { NpcArchetypeDef } from '../types';
import { createTwoHandedNpcMesh } from '../../ecs/systems/twoHandedNpcAnimation';
const def:NpcArchetypeDef={id:'quarterstaff-fighter',name:'Quarterstaff fighter',health:60,behavior:'docile',halfExtent:.4,weaponClass:'twoHanded',maxStamina:100,attackRange:2,attackReach:2,attackDamage:12,attackCooldown:1.5,createMesh:eid=>createTwoHandedNpcMesh('quarterstaff',eid)};
export default def;
