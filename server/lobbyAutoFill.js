// Optional room AI filling, kept separate from upstream lobby/match rules.
import { ERR } from '../shared/constants.js';

export function setAutoFillAi(lobby, session, { on }) {
  const room = lobby.roomOf(session);
  if (!room) return { error: ERR.NOT_IN_ROOM };
  if (room.hostId !== session.playerId) return { error: ERR.NOT_HOST };
  if (room.match) return { error: ERR.ROOM_STARTED };
  if (room.mode === 'solo') return { error: ERR.BAD_TARGET };
  if (typeof on !== 'boolean') return { error: ERR.BAD_MSG };
  if (room.autoFillAi !== on) {
    lobby.dropReplay(room, session.playerId);
    room.autoFillAi = on;
    for (const seat of room.seats) if (seat && !seat.isBot && seat.playerId !== room.hostId) seat.ready = false;
    lobby.broadcastState(room);
  }
  return { ok: true };
}

/** Fill only after the normal start gates pass, reusing manual AI creation and its unique ids/names. */
export function fillRoomAi(lobby, room) {
  if (room.mode === 'solo' || room.autoFillAi !== true) return { ok: true };
  const host = lobby.registry.byId(room.hostId);
  if (!host) return { error: ERR.NOT_HOST };
  for (const seat of room.seats) if (seat === null) {
    const result = lobby.addBot(host);
    if (result.error) return result;
  }
  return { ok: true };
}
