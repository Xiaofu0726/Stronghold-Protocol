// server/match/match/unitePhase.js — Match methods: 联防 glue (the rules: server/match/unite.js) — the UNITE phase in
// both modes (the 联防 field from the helpers' carried state and the leakers' enemies), its end, and the leakers' live
// counts (_uniteLeft, user playtest #6 item 7; _uniteTick in the server-run mode).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, GEO, ERR } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { uniteBattleOpts, uniteSurvivors, plannedUniteSurvivors, nextUnitePlan, uniteReserveHelpers } from '../unite.js';
import { FieldRunner, timelineAt, uniteBillBounds } from '../fields.js';
import { uniteLeft } from '../../sim/spec.js';
import { FLOW_TICKER_PRIORITY, DELAYS, OK, fail } from './common.js';
import { msg } from '../../../shared/i18n.js';
import { onStartUnite } from '../botEmotes.js';

export class CapacityMatchUnite {
  uniteSkipVoters() { return this.humans().filter((ps) => ps.connected && !ps.autoplay); }

  uniteSkipVoteView() {
    if (this.order.length <= 4) return null;
    const plan = this.unitePlan;
    if (this.phase !== PHASE.UNITE || !plan || plan.round >= plan.roundsMax || !uniteReserveHelpers(plan).length) return null;
    const eligible = this.uniteSkipVoters().map((ps) => ps.playerId);
    return { id: `unite:${this.battlePrefix}:${this.round}:${plan.round}`,
      eligible, voters: eligible.filter((pid) => plan.skipVotes.has(pid)),
      needed: Math.floor(eligible.length / 2) + 1, passed: plan.skipRemaining, open: !!this.fields[0]?.live };
  }

  refreshUniteSkipVote() {
    const vote = this.uniteSkipVoteView();
    if (!vote) return;
    const plan = this.unitePlan;
    plan.skipVotes = new Set(vote.voters);
    if (!plan.skipRemaining && vote.open && vote.eligible.length && vote.voters.length >= vote.needed) {
      plan.skipRemaining = true;
      this.tickerText(msg('投票通过：本轮结束后跳过后续全部联防，按剩余漏怪结算'), FLOW_TICKER_PRIORITY);
    }
    this.markPublic();
  }

  voteSkipUnite(ps, { voteId } = {}) {
    const vote = this.uniteSkipVoteView();
    if (!vote || !vote.open) return fail(ERR.WRONG_PHASE);
    if (voteId != null && voteId !== vote.id) return fail(ERR.WRONG_PHASE);
    if (!vote.eligible.includes(ps.playerId)) return fail(ERR.BAD_TARGET, 'only connected manual humans may vote');
    if (vote.passed || this.unitePlan.skipVotes.has(ps.playerId)) return OK;
    this.unitePlan.skipVotes.add(ps.playerId);
    this.refreshUniteSkipVote();
    return OK;
  }

  startUnite(plan) {
    if (this.clientCombat) { this._startUniteClient(plan); return; }
    this.phase = PHASE.UNITE;
    this.unitePlan = plan;
    const limit = this.wave ? this.wave.timeLimit : 60;
    const battle = this.newBattle(this._uniteOpts(plan, limit));
    this.fields = [{ fieldId: 'u', kind: 'unite', players: plan.helpers.map((p) => p.playerId), battle, live: true }];
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._defaultWatch();
    this.markPublic();
    this.tickerText(msg('联防阶段：{names} 迎战突破防线的敌人', { names: plan.helpers.map((p) => p.name) }), FLOW_TICKER_PRIORITY);
    onStartUnite(this, plan); // an AI helper says "合作愉快" once on the open of a 联防 (enabled by default; SP_BOT_EMOTES=0 silences it)
    this._uniteLeftKey = null;
    this.runner = new FieldRunner(this, this.fields, {
      onTick: (runner) => this._uniteTick(runner),
      onDone: (runner) => {
        if (this.phase !== PHASE.UNITE) return;
        const res = runner.resultOf(this.fields[0]);
        this._collectSimErrors(this.fields[0], res);
        this.fields[0].live = false;
        this.deadline = 0;
        this.markPublic();
        this.later(this.scaled(DELAYS.COMBAT_END), () => this._afterUniteWave(plan, res));
      },
    });
    this.runner.start();
  }

  _uniteOpts(plan, limit) {
    const { wave, players } = uniteBattleOpts(this, plan, limit);
    return {
      seed: deriveSeed(this.seed, plan.round > 1 ? `u:${this.round}:${plan.round}` : `u:${this.round}`),
      kind: 'unite',
      modeId: this.modeId,
      round: this.round,
      stageId: this.stageId,
      rect: { ...GEO.UNITE_RECT },
      timeLimit: limit,
      players,
      spawns: this._sanitizeSpawns(wave.spawns),
      routes: wave.routes,
      sharedBoss: null,
      flags: { layerGainsEnabled: false, ...this.gd.dp },
      fieldId: 'u',
      // leaked enemies re-enter with the stats they had: the round template's stat overrides apply again
      enemyOverrides: this.wave && this.wave.overrides ? this.wave.overrides : {},
      waveId: wave.templateId,
    };
  }

  _finishUniteClient() {
    if (this.phase !== PHASE.UNITE) return;
    const f = this.fields[0];
    const res = f.result;
    this._collectSimErrors(f, res);
    this._stopClientCombat();
    f.live = false;
    this.deadline = 0;
    this.markPublic();
    const plan = this.unitePlan;
    this.later(this.scaled(DELAYS.COMBAT_END), () => this._afterUniteWave(plan, res));
  }

  _uniteLeft(ps) {
    const plan = this.unitePlan;
    if (this.phase !== PHASE.UNITE || !plan || !ps || !plan.leakers.includes(ps)) return null;
    const pid = ps.playerId;
    const f = this.fields.find((x) => x && x.kind === 'unite') || null;
    let res = null;
    if (f && f.cc) res = f.done ? f.result : null;
    else if (f && f.battle && f.battle.finished) { try { res = f.battle.result(); } catch { res = null; } }
    if (res && res.synthetic) return plannedUniteSurvivors(plan).get(pid) || 0;
    if (res) return uniteSurvivors(plan, res).get(pid) || 0;
    const sent = plan.leaked.filter((l) => l.sourcePlayerId === pid).length;
    let live = null;
    if (f && f.cc) {
      if (f.mode === 'server' && f.timeline) {
        // the sample is [gt, killed, total, resolved(, left)]: a 联防 sample's `left` is its 5th element
        const sample = timelineAt(f.timeline, this._fieldElapsed(f));
        live = sample && sample[4] && typeof sample[4] === 'object' ? sample[4] : null;
      } else live = f.progress && f.progress.left && typeof f.progress.left === 'object' ? f.progress.left : null;
    } else if (f && f.battle) {
      try { live = uniteLeft(f.battle); } catch { live = null; }
    }
    if (!this._uniteBounds || this._uniteBounds.plan !== plan) this._uniteBounds = { plan, bounds: uniteBillBounds(plan.leaked, this.gd) };
    const bound = this._uniteBounds.bounds.get(pid) ?? sent;
    const standing = live ? Math.min(bound, Math.max(0, Math.trunc(Number(live[pid]) || 0))) : sent;
    return standing + (plan.notReentered.get(pid) || 0);
  }

  _afterUniteWave(plan, result) {
    if (this.phase !== PHASE.UNITE || this.unitePlan !== plan) return;
    const next = nextUnitePlan(plan, result);
    if (next) this.startUnite(next);
    else this.settle(plan, result);
  }
}
