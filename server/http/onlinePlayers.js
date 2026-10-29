// Read-only room/credential/nickname report. Player IDs are used only for internal deduplication.
import { roomAccessOf } from '../access/roomKeys.js';

/** @param {{ registry: import('../net.js').SessionRegistry, lobby: import('../lobby.js').Lobby }} deps */
export function onlinePlayersReport({ registry, lobby }) {
  const live = new Set();
  let lobbyPlayers = 0, waitingRoomPlayers = 0;
  for (const session of registry.byPlayerId.values()) {
    if (!session.connected || session.ws?.readyState !== 1 || live.has(session.playerId)) continue;
    live.add(session.playerId);
    const room = session.roomCode ? lobby.rooms.get(session.roomCode) : null;
    const member = room && !room.disposed && (room.seats.some((s) => s && !s.isBot && !s.left && s.playerId === session.playerId)
      || room.spectators.some((s) => s.playerId === session.playerId));
    if (!member || !room.match) {
      lobbyPlayers++;
      if (member) waitingRoomPlayers++;
    }
  }
  const rooms = [];
  for (const room of lobby.rooms.values()) {
    if (room.disposed) continue;
    const seen = new Set();
    const players = [];
    const add = (person, role) => {
      if (seen.has(person.playerId)) return;
      seen.add(person.playerId);
      const session = registry.byId(person.playerId);
      players.push({ name: session?.name ?? person.name,
        connected: session?.roomCode === room.code && live.has(person.playerId),
        role, host: person.playerId === room.hostId });
    };
    for (const seat of room.seats) if (seat && !seat.isBot && !seat.left) add(seat, 'player');
    for (const spectator of room.spectators) add(spectator, 'spectator');
    rooms.push({ code: room.code, mode: room.mode, inMatch: !!room.match, key: roomAccessOf(room), players });
  }
  return {
    onlinePlayers: live.size, lobbyPlayers, waitingRoomPlayers, inMatchPlayers: live.size - lobbyPlayers,
    rooms: rooms.sort((a, b) => a.code.localeCompare(b.code)),
  };
}
