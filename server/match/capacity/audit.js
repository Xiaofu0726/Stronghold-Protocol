// (i18n-ignore-file: internal auditor messages, never shown to players)
// Independent validation of fixed groups and per-group turn clocks.
export function createCapacityDraftAudit(m, fail) {
  const draftGroups = (stage) => stage.groups || [stage];
  const checkDraftOrder = (stage, label) => {
    const groups = draftGroups(stage);
    const alive = new Set(m.alivePlayers().map((p) => p.playerId));
    const ordered = groups.flatMap((g) => g.order).filter((pid) => alive.has(pid)).sort();
    const want = [...alive].sort();
    if (JSON.stringify(ordered) !== JSON.stringify(want)) fail(`${label}: group orders ${ordered} != living seats ${want}`);
    if (!stage.groups) return;
    if (new Set(groups.map((g) => g.id)).size !== groups.length) fail(`${label}: duplicate group id`);
    if (groups.length !== m.poolGroups.length) fail(`${label}: ${groups.length} groups != ${m.poolGroups.length} fixed pool groups`);
    for (const g of groups) {
      const pool = m.poolGroups.find((p) => p.id === g.id);
      if (!pool || JSON.stringify(g.playerIds) !== JSON.stringify(pool.playerIds)) fail(`${label} group ${g.id}: fixed membership changed`);
      if (new Set(g.order).size !== g.order.length) fail(`${label} group ${g.id}: duplicate turn`);
      for (const pid of g.order) if (!g.playerIds.includes(pid)) fail(`${label} group ${g.id}: outsider ${pid} in order`);
    }
  };
  const peerClocks = (stage, group) => draftGroups(stage).filter((g) => g !== group)
    .map((g) => ({ g, deadline: g.turnDeadline, seconds: g.turnSeconds, token: g.token, timer: g.timer }));
  const checkDraftClock = (stage, group, seconds, label, peers) => {
    const groups = draftGroups(stage);
    const g = group;
    if (g.untimed !== m.soloUntimed) fail(`${label} group ${g.id ?? 1}: untimed ${g.untimed}, expected ${m.soloUntimed}`);
    const want = !g.done && g.idx < g.order.length && !g.untimed ? m.scaled(seconds * 1000) : 0;
    const got = g.turnDeadline ? g.turnDeadline - m.sched.now() : 0;
    if (Math.abs(got - want) > 1) fail(`${label} group ${g.id ?? 1}: deadline in ${got} ms, expected ${want} ms`);
    if (g.turnSeconds != null && Math.abs(g.turnSeconds * 1000 - want) > 1) fail(`${label} group ${g.id ?? 1}: turnSeconds ${g.turnSeconds}, expected ${want / 1000}`);
    const global = groups.length === 1 ? groups[0].turnDeadline || 0 : 0;
    if (m.deadline !== global) fail(`${label}: global deadline ${m.deadline}, expected ${global}`);
    for (const p of peers) if (p.g.turnDeadline !== p.deadline || p.g.turnSeconds !== p.seconds || p.g.token !== p.token || p.g.timer !== p.timer) {
      fail(`${label} group ${g.id ?? 1}: changed group ${p.g.id ?? 1}'s clock`);
    }
    const timers = groups.filter((x) => !x.done && !x.untimed && x.timer != null).map((x) => x.timer);
    if (new Set(timers).size !== timers.length) fail(`${label}: groups share a turn timer`);
    const pending = g.order.slice(g.idx).map((pid) => m.players.get(pid)).filter((p) => p?.alive && !p.left);
    let automatic = false;
    for (const ps of m.aiPicksLast ? pending : []) {
      if (ps.isBot) automatic = true;
      else if (automatic) fail(`${label} group ${g.id ?? 1}: human player ${ps.playerId} ordered after an AI seat`);
    }
  };
  const checkBandPicks = (stage) => {
    for (const g of draftGroups(stage)) {
      const picks = Object.entries(g.picks);
      if (new Set(picks.map(([, id]) => id)).size !== picks.length) fail(`band draft group ${g.id ?? 1}: duplicate strategy`);
      for (const [pid, id] of picks) {
        if (g.playerIds && !g.playerIds.includes(pid)) fail(`band draft group ${g.id}: outsider ${pid} picked`);
        if (stage.picks[pid] !== id) fail(`band draft group ${g.id ?? 1}: ${pid} pick differs from the global map`);
      }
    }
    for (const pid of Object.keys(stage.picks)) if (!draftGroups(stage).some((g) => g.picks[pid] === stage.picks[pid])) {
      fail(`band draft: ${pid} appears only in the global pick map`);
    }
  };

  return { draftGroups, checkDraftOrder, peerClocks, checkDraftClock, checkBandPicks };
}
