import { PHASE } from '../../shared/constants.js';
import { fixedModeBand } from '../../shared/plugins/modeBand.js';

/** One integration point after capacity methods: works for solo, small rooms and expanded rooms. */
export function installModeBand(Match) {
  const enterBandDraft = Match.prototype.enterBandDraft;
  Match.prototype.enterBandDraft = function (...args) {
    const bandId = fixedModeBand(this.gd.mode, this.gd.raw.bands);
    if (!bandId) return enterBandDraft.apply(this, args);
    if (this.phase !== PHASE.INFO_CHECK) return;
    // No draft state, turns, duplicate checks or draft RNG in a fixed-band mode.
    for (const ps of this.order) {
      ps.bandId = bandId;
      ps.lp = this.gd.startLp(bandId);
      this.markPrivate(ps);
    }
    this.enterBattleCheck();
  };
}
