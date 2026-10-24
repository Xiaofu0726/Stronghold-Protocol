import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { validateC2S } from '../shared/protocol.js';

class RecordingMatch {
  constructor(opts) { this.opts = opts; }
  start() {}
  dispose() {}
}
function fixture(t, capacity = 4, mode = 'coop') {
  const registry = new SessionRegistry();
  const lobby = new Lobby({ registry, MatchClass: RecordingMatch, getData: () => ({}) });
  t.after(() => lobby.shutdown());
  const player = name => { const s = registry.create(name); s.connected = true; return s; };
  const host = player('Host');
  assert.equal(lobby.create(host, { mode, difficulty: 'NORMAL', capacity }).ok, true);
  const room = lobby.roomOf(host);
  const send = (session, msg) => lobby.handleMessage(session, msg);
  const set = on => send(host, { t: 'room.setAutoFillAi', on });
  return { lobby, host, room, player, send, set };
}

test('auto-fill protocol requires a real boolean', () => {
  for (const on of [true, false]) assert.equal(validateC2S({ t: 'room.setAutoFillAi', on }), null);
  for (const on of [undefined, null, 0, 1, 'true', {}, []]) assert.notEqual(validateC2S({ t: 'room.setAutoFillAi', on }), null);
});

for (const capacity of [4, 8, 10, 16, 20]) test(capacity + ' seats: fill only on start; preserve humans, existing AI and spectators', t => {
  const { lobby, host, room, player, send, set } = fixture(t, capacity);
  const guest = player('Guest'), spectator = player('Spectator');
  assert.equal(lobby.join(guest, { code: room.code }).ok, true);
  assert.equal(lobby.spectate(spectator, { code: room.code }).ok, true);
  assert.equal(room.toState().autoFillAi, false);
  assert.equal(lobby.addBot(host).ok, true);
  const existingBot = room.seats[2];
  assert.equal(set(true).ok, true);
  assert.equal(room.seats.filter(Boolean).length, 3, 'enabling leaves waiting seats free');
  assert.equal(lobby.start(host).error, 'NOT_READY');
  assert.equal(room.seats.filter(Boolean).length, 3, 'failed readiness gate cannot add AI');
  assert.equal(lobby.ready(guest, { ready: true }).ok, true);
  assert.equal(lobby.start(host).ok, true);
  assert.equal(room.seats.length, capacity);
  assert.ok(room.seats.every(Boolean));
  assert.equal(new Set(room.seats.map(s => s.playerId)).size, capacity);
  assert.equal(room.seats[0].playerId, host.playerId);
  assert.equal(room.seats[1].playerId, guest.playerId);
  assert.equal(room.seats[2], existingBot);
  assert.equal(room.spectators[0].playerId, spectator.playerId);
  assert.equal(room.match.opts.seats.length, capacity, 'match receives the filled roster');
  assert.ok(room.seats.slice(2).every(s => s.isBot && s.ready && s.connected));
  assert.equal(set(false).error, 'ROOM_STARTED');
  assert.equal(send(guest, { t: 'room.setAutoFillAi', on: false }).error, 'NOT_HOST');
  room.match.opts.onEnd({});
  assert.equal(room.toState().autoFillAi, true, 'setting survives returning to the room');
  assert.equal(lobby.leave(host).ok, true);
  assert.equal(room.hostId, guest.playerId);
  assert.equal(room.toState().autoFillAi, true, 'setting survives host migration');
});

test('disabled by default; toggling off preserves manually added bots and changing the option resets readiness', t => {
  const { lobby, host, room, player, set } = fixture(t);
  const guest = player('Guest');
  lobby.join(guest, { code: room.code });
  lobby.ready(guest, { ready: true });
  assert.equal(set(false).ok, true);
  assert.equal(room.seats[1].ready, true, 'same setting does not reset readiness');
  assert.equal(set(true).ok, true);
  assert.equal(room.seats[1].ready, false);
  lobby.addBot(host);
  const bot = room.seats[2];
  assert.equal(set(false).ok, true);
  assert.equal(room.seats[2], bot);
  lobby.ready(guest, { ready: true });
  assert.equal(lobby.start(host).ok, true);
  assert.equal(room.match.opts.seats.length, 3);
  assert.equal(room.seats[3], null);
});

test('default-off start keeps empty seats and solo refuses the option', t => {
  const a = fixture(t, 20);
  assert.equal(a.lobby.start(a.host).ok, true);
  assert.equal(a.room.match.opts.seats.length, 1);
  const b = fixture(t, 4, 'solo');
  assert.equal(b.set(true).error, 'BAD_TARGET');
  assert.equal(b.lobby.start(b.host).ok, true);
  assert.equal(b.room.match.opts.seats.length, 1);
});

test('permissions, room resizing and full rooms follow the existing lobby controls', t => {
  const { lobby, room, host, player, send, set } = fixture(t);
  const guest = player('Guest');
  assert.equal(send(guest, { t: 'room.setAutoFillAi', on: true }).error, 'NOT_IN_ROOM');
  lobby.join(guest, { code: room.code });
  assert.equal(send(guest, { t: 'room.setAutoFillAi', on: true }).error, 'NOT_HOST');
  assert.equal(set(true).ok, true);
  assert.equal(lobby.setCapacity(host, { capacity: 20 }).ok, true);
  lobby.ready(guest, { ready: true });
  assert.equal(lobby.start(host).ok, true);
  assert.equal(room.match.opts.seats.length, 20);
  room.match.opts.onEnd({});
  lobby.ready(guest, { ready: true });
  const ids = room.seats.map(s => s.playerId);
  assert.equal(lobby.start(host).ok, true);
  assert.deepEqual(room.match.opts.seats.map(s => s.playerId), ids, 'already full: no extra bots');
});
