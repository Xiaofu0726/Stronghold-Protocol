import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldCamera, prepCameraFor, deployFoldsShop } from '../../public/js/ui/gameLogic.js';

const players = ['a', 'b'].map((playerId, seat) => ({ playerId, seat, alive: true }));
for (const round of [6, 14]) {
  for (const myId of ['a', 'b']) {
    for (const collapsed of [false, true]) {
      test(`deployment camera remains fixed: round=${round}, player=${myId}, folded=${collapsed}`, () => {
        const pub = { round, bossRound: 14, hiddenRound: 15, players };
        const current = prepCameraFor(pub, myId, collapsed);
        for (const enabled of [true, false]) {
          for (const [drag, facing] of [[false, false], [true, false], [false, true], [false, false]]) {
            const deployFold = deployFoldsShop({ ownPrep: true, editable: true, drag, facing, enabled });
            assert.equal(collapsed || deployFold, collapsed || (enabled && (drag || facing)));
            const next = foldCamera({ pub, myId, folded: collapsed, ownPrep: true, pen: false,
              busy: drag || facing, current });
            assert.equal(next, null, 'pickup, direction choice and drop never request a camera change');
          }
        }
        const changed = { pub, myId, folded: !collapsed, ownPrep: true, pen: false, current };
        assert.equal(foldCamera({ ...changed, busy: true }), null, 'manual fold waits for deployment');
        assert.deepEqual(foldCamera({ ...changed, busy: false }), prepCameraFor(pub, myId, !collapsed),
          'manual shop folding still changes framing when deployment ends');
        assert.equal(foldCamera({ ...changed, pen: true }), null, 'enemy preview keeps its own camera');
        assert.equal(foldCamera({ ...changed, ownPrep: false }), null, 'scouting and combat keep their cameras');
      });
    }
  }
}
