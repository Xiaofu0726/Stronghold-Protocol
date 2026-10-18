// server/match/match/phases.js — Match methods: the round flow up to the prep — INFO_CHECK, the strategy draft
// (BAND_DRAFT: parallel fixed-pool groups, a BAND_TURN_SECONDS countdown per group turn, group-local 队友已选,
// the highlighted strategy on a timeout and skips),
// BATTLE_CHECK and ROUND_START (the round's enemies — a normal wave or the boss pairing — planned before the players'
// round start).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';

import { botPickBand } from '../bot.js';
import { OK, fail } from './common.js';

/** Single-pool diagnostics and old fixtures keep their readable/writable first-group fields. */
export function installDraftFacade(stage, fields) {
  for (const field of fields) Object.defineProperty(stage, field, {
    enumerable: true,
    get() { return this.groups[0]?.[field]; },
    set(value) { if (this.groups[0]) this.groups[0][field] = value; },
  });
  return stage;
}

export class CapacityMatchPhases {
  nextDraftId(kind) { return `${kind}:${this.battlePrefix}:${this.round}:${++this.draftSeq}`; }

  manualDraftPicker(ps) { return !!ps && !ps.isBot; }

  makeDraftGroups({ shuffle = true } = {}) {
    return this.poolGroups.map(({ id, playerIds }) => {
      const order = playerIds.slice();
      if (shuffle) {
        if (!this.isSolo) this.rngDraft.shuffle(order);
        this.prioritizeDraftOrder(order);
      }
      return { id, playerIds: playerIds.slice(), order, idx: 0, picks: {}, untimed: this.soloUntimed,
        turnDeadline: 0, turnSeconds: 0, timer: null, token: 0, done: !order.length };
    });
  }

  draftGroup(playerId = null) {
    const groups = this.draft?.groups || [];
    return playerId == null ? groups[0] || null : groups.find((g) => g.playerIds.includes(playerId)) || null;
  }

  draftTargetError(stage, group, { draftId, groupId } = {}) {
    if (draftId != null && draftId !== stage.id) return fail(ERR.WRONG_PHASE);
    if (!group || (groupId != null && groupId !== group.id)) return fail(ERR.BAD_TARGET);
    return null;
  }

  clearDraftGroupTimer(group) {
    this.cancel(group.timer);
    group.timer = null;
    group.turnDeadline = 0;
    group.turnSeconds = 0;
    group.testTimer = null;
    group.token++;
  }

  armDraftGroupTimer(group, ms, expire) {
    group.testTimer = { ms, expire };
    if (this.test === true && this.testTimers === false) {
      group.turnDeadline = 0;
      group.turnSeconds = 0;
      return;
    }
    group.turnSeconds = ms / 1000;
    group.turnDeadline = this.sched.now() + ms;
    group.timer = this.later(ms, expire);
  }

  syncDraftDeadline(stage) {
    // A shared public frame cannot have one current-turn countdown for multiple parallel groups.
    this.deadline = stage.groups.length === 1 ? stage.groups[0].turnDeadline || 0 : 0;
  }

  prioritizeDraftOrder(order, from = 0) {
    if (!this.aiPicksLast) return false;
    const pending = order.slice(from);
    const manual = [];
    const automatic = [];
    for (const pid of pending) (this.manualDraftPicker(this.players.get(pid)) ? manual : automatic).push(pid);
    const next = [...manual, ...automatic];
    if (next.every((pid, i) => pid === pending[i])) return false;
    order.splice(from, pending.length, ...next);
    return true;
  }

  enterBandDraft() {
    if (this.phase !== PHASE.INFO_CHECK) return;
    this.phase = PHASE.BAND_DRAFT;
    const skips = this.isSolo ? 0 : this.gd.bandDraft.skipsPerPlayer;
    const untimed = this.soloUntimed;
    const groups = this.makeDraftGroups();
    for (const g of groups) g.skipsLeft = Object.fromEntries(g.order.map((pid) => [pid, skips]));
    this.draft = installDraftFacade({
      id: this.nextDraftId('band'), groups, picks: {}, untimed,
      /** playerId → the strategy highlighted in the draft screen (g.bandFocus) */
      focus: new Map(),
    }, ['order', 'idx', 'skipsLeft', 'turnDeadline']);
    this.setDeadline(0);
    for (const g of groups) this.startDraftTurn(g);
    this.markPublic();
  }

  draftTurn(playerId = null) {
    const g = this.draftGroup(playerId);
    return g && !g.done ? g.order[g.idx] ?? null : null;
  }

  startDraftTurn(group = this.draftGroup()) {
    const d = this.draft;
    if (this.phase !== PHASE.BAND_DRAFT || !d || !group) return;
    const g = group;
    this.clearDraftGroupTimer(g);
    // loop-cap: at most the fixed group roster, each skipped seat advances idx.
    while (g.idx < g.order.length) {
      const ps = this.players.get(g.order[g.idx]);
      if (ps && ps.alive && !ps.left && !d.picks[ps.playerId]) break;
      g.idx++;
    }
    g.done = g.idx >= g.order.length;
    if (g.done) {
      this.syncDraftDeadline(d);
      this.markPublic();
      if (d.groups.every((x) => x.done) && !d.finishPending) {
        d.finishPending = true;
        this.later(0, () => {
          if (this.draft === d && this.phase === PHASE.BAND_DRAFT && d.groups.every((x) => x.done)) this.finishBandDraft(false);
        });
      }
      return;
    }
    const token = g.token;
    g.turnSeconds = g.untimed ? 0 : this.bandTurnMs() / 1000;
    if (!g.untimed) {
      const ms = this.bandTurnMs();
      this.armDraftGroupTimer(g, ms, () => {
        if (this.phase !== PHASE.BAND_DRAFT || this.draft !== d || token !== g.token) return;
        const pid = this.draftTurn(g.playerIds[0]);
        if (pid) this._applyBand(this.players.get(pid), this.timeoutBand(pid));
      });
    }
    this.syncDraftDeadline(d);
    const cur = this.players.get(g.order[g.idx]);
    if (cur && cur.botControlled) this.scheduleBandBot(g);
    this.markPublic();
  }

  scheduleBandBot(group = this.draftGroup()) {
    const d = this.draft;
    const g = group;
    if (!d || !g || g.done) return;
    const token = g.token;
    this.later(0, () => {
      if (this.phase !== PHASE.BAND_DRAFT || this.draft !== d || token !== g.token) return;
      const ps = this.players.get(g.order[g.idx]);
      if (!ps || !ps.botControlled) return;
      // a strategy a teammate already took is not selectable (队友已选): the bot re-draws, else the first free one
      let id = botPickBand(this, ps);
      for (let k = 0; k < 8 && this.bandTaken(id, ps.playerId); k++) id = botPickBand(this, ps);
      if (this.bandTaken(id, ps.playerId)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, ps.playerId)) || id;
      this._applyBand(ps, id, { dedupe: true });
    });
  }

  bandTaken(bandId, playerId) {
    const picks = this.draftGroup(playerId)?.picks || {};
    for (const [pid, id] of Object.entries(picks)) if (pid !== playerId && id === bandId) return true;
    return false;
  }

  bandFocus(ps, bandId, opts = {}) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    const targetError = this.draftTargetError(d, this.draftGroup(ps.playerId), opts);
    if (targetError) return targetError;
    if (!ps.alive || ps.left) return fail(ERR.ELIMINATED);
    if (d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (!(d.focus instanceof Map)) d.focus = new Map();
    if (bandId == null) { d.focus.delete(ps.playerId); return OK; }
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    d.focus.set(ps.playerId, bandId);
    return OK;
  }

  pickBand(ps, bandId, opts = {}) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const targetError = this.draftTargetError(this.draft, this.draftGroup(ps.playerId), opts);
    if (targetError) return targetError;
    if (!ps.alive || ps.left) return fail(ERR.ELIMINATED);
    if (this.draft.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (this.draftTurn(ps.playerId) !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    if (this.bandTaken(bandId, ps.playerId)) return fail(ERR.BAD_TARGET, '队友已选'); // i18n-ignore: developer detail (players see ERR_TEXT)
    this._applyBand(ps, bandId);
    return OK;
  }

  _applyBand(ps, bandId, { dedupe = false } = {}) {
    const d = this.draft;
    const g = ps && this.draftGroup(ps.playerId);
    if (!d || !g || !ps.alive || ps.left || d.picks[ps.playerId]) return;
    let id = this.gd.bandAllowed(bandId) ? bandId : this.defaultBand(ps.playerId);
    if (dedupe && this.bandTaken(id, ps.playerId)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, ps.playerId)) || id;
    d.picks[ps.playerId] = id;
    g.picks[ps.playerId] = id;
    ps.bandId = id;
    ps.lp = this.gd.startLp(id);
    this.markPrivate(ps);
    this.markPublic();
    this.startDraftTurn(g);
  }

  skipBand(ps, opts = {}) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    const g = this.draftGroup(ps.playerId);
    const targetError = this.draftTargetError(d, g, opts);
    if (targetError) return targetError;
    if (this.isSolo) return fail(ERR.WRONG_PHASE, 'no skip in solo');
    if (!ps.alive || ps.left) return fail(ERR.ELIMINATED);
    if (d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (this.draftTurn(ps.playerId) !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!(g.skipsLeft[ps.playerId] > 0)) return fail(ERR.ALREADY, 'no skip left');
    if (g.order.length - g.idx <= 1) return fail(ERR.BAD_TARGET, 'nobody to pass to');
    g.skipsLeft[ps.playerId]--;
    g.order.splice(g.idx, 1);
    let at = g.order.length;
    if (this.aiPicksLast) {
      for (let j = g.order.length - 1; j >= g.idx; j--) {
        if (!this.players.get(g.order[j])?.isBot) { at = j + 1; break; }
      }
    }
    g.order.splice(at, 0, ps.playerId);
    this.startDraftTurn(g);
    return OK;
  }

  finishBandDraft(timeout) {
    if (this.phase !== PHASE.BAND_DRAFT) return;
    for (const g of this.draft.groups) this.clearDraftGroupTimer(g);
    for (const ps of this.order) {
      if (!ps.alive || ps.left) continue;
      if (!this.draft.picks[ps.playerId]) {
        // One after another in seat order, so each default sees earlier assignments within its group.
        const id = this.defaultBand(ps.playerId);
        this.draft.picks[ps.playerId] = id;
        this.draftGroup(ps.playerId).picks[ps.playerId] = id;
        ps.bandId = id;
        ps.lp = this.gd.startLp(id);
      }
      this.markPrivate(ps);
    }
    void timeout;
    this.enterBattleCheck();
  }
}
