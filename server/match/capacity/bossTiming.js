// Fork timing policy; keep generated official templates and unrelated spawns intact.
export function applyGunEntryTiming(templateId, spawns, actions) {
  if (templateId !== 'act1autochess_h08_02') return;
  for (const spawn of spawns) {
    if (spawn.enemyKey !== 'enemy_9017_achunt_2' || spawn.tag !== 'boss' || spawn.time !== 10) continue;
    spawn.time = 0.1;
    const action = actions.find(a => a.index === spawn.actionIndex);
    if (action) action.time = 0.1;
  }
}
