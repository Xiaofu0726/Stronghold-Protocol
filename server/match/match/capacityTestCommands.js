// server/match/match/testCommands.js — Match methods: g.test, the host's test-mode commands
// (DESIGN §34.8 phase 2). Installed on Match.prototype by server/match/Match.js.
//
// Every command calls a primitive the real match already uses (addFunds, acquireChess,
// acquireItem, addLayers, pickBand, startRound, levelUp, addBounty, pickCard,
// pickPersonalChoice, enterPrep, enterSpDraft, finishBandDraft, prepDeadline). Nothing here
// retargets another player, another room, a file, or a plugin script. The commanding seat is
// the host's own PlayerState.
//
// [ASSUMED] Choices no official source settles:
//   * Co-op test rooms are allowed. Only the current host commands, and a command changes that
//     host's seat only. A normal room never gains the flag.
//   * funds / lp / bond layers / team LP are absolute counts. A lower bond count is refused
//     (addLayers cannot decrease). An equal count is a success that changes nothing.
//   * hp is the shared boss pool's current HP, written directly so it does not credit boss
//     damage. It is refused while the pool does not exist. It is also accepted during
//     FINAL_ASSAULT / HIDDEN_CORE, which is when the pool exists in a real match. teamLp is
//     the same. Operator HP inside a running battle is sim state and is not a command.
//   * Equipment grants use the existing displayed-offer overdraw bookkeeping, even with no stock.
//   * A token grant is +1 of a placeable token of a chess the host already owns (board, hand
//     or temp), even past that token's deploy limit. An unowned token is refused.
//   * strategy during BAND_DRAFT is pickBand (that method sets the strategy's starting LP).
//     After the draft, bandId changes and LP is kept unless resetLp is true.
//   * level calls levelUp: it spends the real upgrade price and obeys that method's gate
//     (PREP, not ready, not max level).
//   * round calls startRound. Intermediate rounds are not settled. An accepted jump first
//     eliminates every alive player with LP <= 0, the same helper settlement uses. If nobody
//     remains, the match ends eliminated and the round does not start. A jump into the hidden
//     round opens team LP with the Final Assault's helper when that pool was never opened.
//     Refused before a strategy is chosen, and while a battle is live. A refusal does not eliminate.
//   * phase prep from ROUND_START calls enterPrep and therefore skips a 机变 draft that has
//     not started. From SP_DRAFT it is refused until every pick is in, so an open draft is
//     not aborted. phase combat calls prepDeadline (the real timeout path), not a new jump.
//   * The shop queue replaces the whole next roll once, frozen slots included. A queued shop blocks level upgrades until consumed.
//   * Timers off holds the phase callback instead of scaling time to zero (a zero delay would
//     fire at once). Turning them on re-arms the original duration, not the leftover.
//   * Rate: 8 attempted commands of one type per 10s of scheduler time, counted before the
//     audit. Guests (NOT_HOST) and spectators (SPECTATOR) share that bucket. TEST_FORBIDDEN
//     does not. An oversized id or string is refused before it is traced (BAD_TARGET or
//     BAD_MSG, never clamped). The audit keeps the parsed args, or { rejected: true } when
//     the shape itself was refused.
//   * bond count sets the ordinary extra-member bonus (0..99), allowing activation without
//     pieces. computeBonds still decides the tier; a mode-disabled bond is refused.

import { ERR, PHASE } from '../../../shared/constants.js';

import { OK, fail } from './common.js';

export class CapacityMatchTestCommands {
  _testRound(ps, round) {
    const blocked = this._testQuiet();
    if (blocked) return blocked;
    if (this.phase === PHASE.INFO_CHECK || this.phase === PHASE.BAND_DRAFT || !ps.bandId) return fail(ERR.WRONG_PHASE);
    const hidden = this.gd.hiddenRound;
    const hi = Math.max(this.gd.lastRound || 0, hidden > 0 ? hidden : 0);
    if (round > hi) return fail(ERR.BAD_TARGET, `round|${JSON.stringify({ hi })}`);
    this.eliminateBroken();
    if (!this.alivePlayers().length) {
      this.finish({ victory: false, reason: 'eliminated' });
      return OK;
    }
    this.setDeadline(0);
    this.cancel(this._turnTimer);
    this._turnToken++;
    for (const stage of [this.draft, this.sp]) for (const group of stage?.groups || []) this.clearDraftGroupTimer(group);
    this.startRound(round, () => {
      // Run after any blocking battleCheck window and the actual round start. Ordinary progression
      // keeps the Final Assault's LP; a jump never fought it. Boss prep itself still has no team LP.
      if (hidden > 0 && hidden !== this.gd.bossRound && this.round === hidden && this.teamLp == null) this._openTeamLp();
    });
    return OK;
  }

  _testPhase(name) {
    if (name === 'advance') return this._testAdvance();
    if (name === 'battleCheck') {
      if (this.phase !== PHASE.BAND_DRAFT) return fail(ERR.WRONG_PHASE);
      this.finishBandDraft();
      return OK;
    }
    if (name === 'prep') {
      if (this.phase === PHASE.ROUND_START) { this.setDeadline(0); this.enterPrep(); return OK; }
      if (this.phase === PHASE.SP_DRAFT) {
        const s = this.sp;
        if (s && s.groups.some(group => group.order.some(id => s.picks[id] == null))) return fail(ERR.WRONG_PHASE);
        this.finishSpDraft();
        return OK;
      }
      return fail(ERR.WRONG_PHASE);
    }
    if (name === 'sp') {
      if (this.phase !== PHASE.ROUND_START || !this.gd.spRounds().includes(this.round)) return fail(ERR.WRONG_PHASE);
      this.setDeadline(0);
      this.enterSpDraft();
      return OK;
    }
    if (name === 'combat') {
      if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
      this.prepDeadline();
      return OK;
    }
    return fail(ERR.BAD_TARGET);
  }

  _testAdvance() {
    const stage = this.phase === PHASE.BAND_DRAFT ? this.draft : this.phase === PHASE.SP_DRAFT ? this.sp : null;
    const pending = stage?.groups?.find(group => !group.done && group.testTimer);
    if (this.testTimers === false && pending) {
      pending.testTimer.expire();
      return OK;
    }
    const held = this._testHeld;
    if (!held || typeof held.fn !== 'function') return fail(ERR.WRONG_PHASE);
    this._testHeld = null;
    this._testArmed = null;
    held.fn();
    return OK;
  }

  _testTimers(on) {
    // COMBAT / UNITE / FINAL_ASSAULT / HIDDEN_CORE write this.deadline themselves. Zeroing it
    // hides every countdown and turning timers back on cannot restore that clock.
    if (this.phase === PHASE.COMBAT || this.phase === PHASE.UNITE || this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE || this.fields.some((f) => f && f.live)) {
      return fail(ERR.WRONG_PHASE, 'timers');
    }
    if (this.phase === PHASE.LOBBY || this.phase === PHASE.RESULT) return fail(ERR.WRONG_PHASE);
    if (on === this.testTimers) return OK;
    const stage = this.phase === PHASE.BAND_DRAFT ? this.draft : this.phase === PHASE.SP_DRAFT ? this.sp : null;
    if (stage?.groups) {
      this.testTimers = on;
      for (const group of stage.groups) {
        if (this.phase === PHASE.BAND_DRAFT) this.startDraftTurn(group);
        else this.startSpTurn(group);
      }
      this.syncDraftDeadline(stage);
      this.markPublic();
      return OK;
    }
    if (on) {
      const held = this._testHeld;
      this.testTimers = true;
      this._testHeld = null;
      if (held) this.setDeadline(held.seconds, held.fn, { silent: !!held.silent });
    } else {
      this.testTimers = false;
      const armed = this._testArmed;
      this.cancel(this._phaseTimer);
      this._phaseTimer = null;
      this.deadline = 0;
      this._testHeld = armed || null;
    }
    if (this.phase === PHASE.BAND_DRAFT && this.draft) this.draft.turnDeadline = this.deadline;
    this.markPublic();
    return OK;
  }
}
