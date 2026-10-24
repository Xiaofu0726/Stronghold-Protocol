// server/match/match/views.js — Match methods: the state builders — m.public (publicView with statusOf / fieldOf, the
// fields' progress, the teammates' live pendingLp / uniteLeft, the SETTLE uniteResult), the nextEnemies preview of
// m.private and the prep scout's m.field (prepFieldMeta: board, hand and temp as units, the scouted player's effects and
// coming enemies; in a boss round's prep on the player's half of the boss field).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE } from '../../../shared/constants.js';
import { TEST_PUBLIC_LOG } from '../../../shared/testMode.js';

import { bondList, offBondCounts } from '../bondsMeta.js';
import { cardView } from '../choices.js';

/** Milliseconds since the match started. A stamp before the start, or a bad stamp, is 0. The stored log keeps the epoch. */
function auditClock(at, startedAt) {
  const stamp = Number(at);
  const start = Number(startedAt);
  if (!Number.isFinite(stamp) || !Number.isFinite(start)) return 0;
  return Math.max(0, stamp - start);
}

/** A reported capsule numerator clamped to its denominator, else null (unknown — never a fabricated 0). */

/**
 * A scouted operator's potential (below 6) and 练度 (0.2.2), like the sim's UnitInfo: PlayerState.loadoutFor's
 * `potential` / `cultivate` (null for a stand-in or a prototype 自选 pick: neither field).
 */

export class CapacityMatchViews {
  statusOf(ps) {
    if (ps.left) return 'left';
    if (!ps.alive) return 'dead';
    switch (this.phase) {
      case PHASE.INFO_CHECK: return ps.infoReady ? 'ready' : 'deciding';
      case PHASE.BAND_DRAFT:
        if (this.draft && this.draft.picks[ps.playerId]) return 'ready';
        return this.draft && this.draftTurn(ps.playerId) === ps.playerId ? 'deciding' : 'acting';
      case PHASE.SP_DRAFT:
        if (this.sp && this.sp.picks[ps.playerId] != null) return 'ready';
        return this.sp && this.spTurn(ps.playerId) === ps.playerId ? 'deciding' : 'acting';
      case PHASE.PREP: return ps.ready ? 'ready' : 'acting';
      case PHASE.COMBAT: case PHASE.FINAL_ASSAULT: case PHASE.HIDDEN_CORE: {
        const f = this.fields.find((x) => x.players.includes(ps.playerId));
        return f && f.live ? 'combat' : 'done';
      }
      case PHASE.UNITE: return this.unitePlan && this.unitePlan.helpers.includes(ps) ? 'helping' : 'done';
      case PHASE.ROUND_START: return 'acting';
      default: return 'done';
    }
  }

  publicView() {
    const v = {
      t: 'm.public',
      phase: this.phase,
      round: this.round,
      lastRound: this.gd.lastRound,
      deadline: this.deadline,
      serverNow: this.sched.now(),
      modeId: this.modeId,
      difficulty: this.difficulty,
      stageId: this.stageId,
      ...(this.version ? { version: this.version } : {}),
      setupRevision: this.setupRevision,
      rerollVote: this.setupVote ? {
        id: this.setupVote.id,
        proposerId: this.setupVote.proposerId,
        voters: this.setupVote.voters.slice(),
        agreed: [...this.setupVote.agreed],
      } : null,
      factions: this.factions.slice(),
      disabledBonds: [...new Set([...this.disabledBonds, ...this.staticInactiveBonds])].sort(),
      drawnDisabledBonds: this.disabledBonds.slice(),
      bannedChess: this.bannedChess.slice(),
      bossId: this.bossId,
      hiddenBossId: this.hiddenBossId,
      bossRound: this.gd.bossRound,
      hiddenRound: this.gd.hiddenRound,
      bossPairs: this.bossWaves ? this.bossWaves.map(w => w.players.slice()) : this.bossPairs ? this.bossPairs.map(ids => ids.slice()) : null,
      spRound: this.gd.spRounds().includes(this.round),
      playerCount: this.order.length,
      poolGroups: this.poolGroups.map(({ id, playerIds, scale }) => ({ id, playerIds: playerIds.slice(), scale })),
      // DESIGN §14: 'client' = battles are simulated by the browsers (b.start specs), 'server' = legacy streaming
      combatMode: this.clientCombat ? 'client' : 'server',
      // solo pause (g.pause, DESIGN §14): the battle, its field clock and every deadline are frozen while true
      paused: !!this.paused,
      players: this.order.map((ps) => ({
        playerId: ps.playerId,
        seat: ps.seat,
        name: ps.name,
        isBot: ps.isBot,
        ...(Number.isInteger(ps.aiTakeoverRound) ? { aiTakeoverRound: ps.aiTakeoverRound } : {}),
        connected: ps.isBot || (ps.connected && !ps.left),
        alive: ps.alive,
        lp: Math.max(0, ps.lp),
        bandId: ps.bandId,
        shopLevel: ps.shop.level,
        boardCount: ps.deployCount,
        ready: this.phase === PHASE.INFO_CHECK ? ps.infoReady : ps.ready,
        // the strip of a teammate watching this player (DESIGN §20.15): every bond with members, layers or an active tier
        // (= the player's own m.private list without thresholds / countsHand — the client reads those from bonds.json),
        // this round's in-battle gains included once the COMBAT phase ended (PlayerState.bondsView); [] once eliminated —
        // nobody can watch an eliminated player (g.watch refuses them, they have no field) and the result screen reads
        // m.result's own bonds, so their layers would only cost every m.public bytes for the rest of the match
        // (the mode-off bonds with members included, `off: true`, as in m.private — bondsMeta.offBondCounts)
        bonds: ps.alive ? bondList(this.gd, ps.bondsView(), { off: offBondCounts(ps.gd || this.gd, ps) }) : [],
        fieldId: this.fieldOf(ps),
        status: this.statusOf(ps),
        autoplay: ps.autoplay,
        // 干员皮肤 (docs/SKINS.md): PUBLIC on purpose — this is how a teammate sees your skin, and the reason the
        // renderer reads the skin off the unit rather than off the local player. Omitted when empty, which is the normal
        // case: the appearance comes from a cosmetic plugin each player switches on for themself, so most have none.
        ...(Object.keys(ps.skins).length ? { skins: ps.skins } : {}),
        // the LP this round's own battle will cost at settlement so far (COMBAT / 联防 only, omitted when 0)
        ...this._pendingLpView(ps),
      })),
      fields: this.fields.map((f) => {
        const v = { fieldId: f.fieldId, kind: f.kind, players: f.players.slice(), live: !!f.live };
        const pr = this._fieldProgress(f);
        if (pr) v.progress = pr;
        return v;
      }),
    };
    if (this.offers.length) v.offers = this.offerViews();
    if (this.teamLp != null) v.teamLp = Math.max(0, Math.round(this.teamLp));
    // 最终攻势 / 隐秘核心: when the overtime drain starts (ms epoch; `deadline` is the level's 120 s countdown)
    if ((this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE) && this.overtimeAt) v.overtimeAt = this.overtimeAt;
    if (this.bossPool) v.bossHp = { hp: Math.max(0, Math.round(this.bossPool.hp)), max: Math.round(this.bossPool.maxHp) };
    if (this.phase === PHASE.BAND_DRAFT && this.draft) {
      const d = this.draft;
      // turnSeconds: the length of a turn (the countdown gauge's total; 0 when untimed) — deadline = turnDeadline
      v.draft = {
        id: d.id,
        groups: d.groups.map((g) => ({
          id: g.id, playerIds: g.playerIds.slice(), order: g.order.slice(),
          turn: g.done ? null : g.order[g.idx] ?? null, picks: { ...g.picks }, skipsLeft: { ...g.skipsLeft },
          turnDeadline: g.turnDeadline || 0, turnSeconds: g.turnSeconds || 0, untimed: !!g.untimed || (this.test === true && this.testTimers === false), done: !!g.done,
        })),
        order: d.order.slice(), turn: this.draftTurn(), picks: { ...d.picks }, skipsLeft: { ...d.skipsLeft }, turnDeadline: d.turnDeadline || 0,
        turnSeconds: d.untimed ? 0 : this.bandTurnMs() / 1000, untimed: !!d.untimed || (this.test === true && this.testTimers === false),
      };
    }
    if (this.phase === PHASE.SP_DRAFT && this.sp) {
      const s = this.sp;
      v.sp = {
        id: s.id,
        groups: s.groups.map((g) => ({
          id: g.id, playerIds: g.playerIds.slice(), order: g.order.slice(),
          family: g.family, name: g.name, desc: g.desc, eventId: g.eventId,
          cards: g.cards.map((c) => ({ ...cardView(c), soldOut: c.kind === 'item' && !this.itemPoolFor(g.playerIds[0]).canGain(c.id) })),
          turn: g.done ? null : g.order[g.idx] ?? null,
          picks: { ...g.picks }, taken: { ...g.taken }, turnDeadline: g.turnDeadline || 0,
          turnSeconds: g.turnSeconds || 0, untimed: !!g.untimed || (this.test === true && this.testTimers === false), done: !!g.done,
        })),
        family: s.family, name: s.name, desc: s.desc, eventId: s.eventId,
        cards: s.cards.map(c => ({ ...cardView(c), soldOut: c.kind === 'item' && !this.itemPool.canGain(c.id) })), order: s.order.slice(),
        turn: this.spTurn(), picks: { ...s.picks }, taken: { ...s.taken }, untimed: !!s.untimed || (this.test === true && this.testTimers === false),
        turnDeadline: s.turnDeadline || 0, turnSeconds: s.turnSeconds || 0,
      };
    }
    if (this.phase === PHASE.UNITE && this.unitePlan) v.unite = {
      helpers: this.unitePlan.helpers.map((p) => p.playerId), leakers: this.unitePlan.leakers.map((p) => p.playerId),
      round: this.unitePlan.round, roundsMax: this.unitePlan.roundsMax, skipVote: this.uniteSkipVoteView(),
    };
    // SETTLE after a 联防: its outcome as data (settle.js uniteResultView; GitHub #235, PR #112) — { through, helpers,
    // leakers, losses: { playerId: the LP settlement charged this round } } — the client's result box reads the viewer's
    // own charge from it; absent when no 联防 resolved (the client then shows the round's own battle result)
    if (this.phase === PHASE.SETTLE && this.uniteResultView) {
      const ur = this.uniteResultView;
      v.uniteResult = { through: ur.through, helpers: ur.helpers.slice(), leakers: ur.leakers.slice(), losses: { ...ur.losses } };
    }
    // Test match (DESIGN §34.8). Omitted entirely when the flag is off, so a normal m.public stays identical.
    if (this.test === true) {
      v.test = true;
      v.testActions = this.testActions | 0;
      v.testTimers = this.testTimers !== false;
      const log = Array.isArray(this.testLog) ? this.testLog : [];
      v.testLog = log.slice(-TEST_PUBLIC_LOG).map((e) => ({
        seq: e.seq, playerId: e.playerId, cmd: e.cmd, args: e.args,
        // The stored row keeps the scheduler epoch. The dock clock is time since this match started.
        at: auditClock(e.at, this.startedAt),
        ok: e.ok === true,
        ...(e.code ? { code: e.code } : {}),
        ...(e.detail ? { detail: e.detail } : {}),
      }));
    }
    return v;
  }
}
