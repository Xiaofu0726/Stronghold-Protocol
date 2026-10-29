// Read-only online identities, independent of match hosts and battle simulation.

/**
 * Connected humans, deduplicated by playerId. Lobby includes waiting-room members.
 * @param {{ registry: import('../net.js').SessionRegistry, lobby: import('../lobby.js').Lobby }} deps
 */
export function onlinePlayersReport({ registry, lobby }) {
  const rooms = new Map();
  const seen = new Set();
  let onlinePlayers = 0, lobbyPlayers = 0, waitingRoomPlayers = 0;
  for (const session of registry.byPlayerId.values()) {
    if (!session.connected || session.ws?.readyState !== 1 || seen.has(session.playerId)) continue;
    seen.add(session.playerId);
    onlinePlayers++;
    const room = session.roomCode ? lobby.rooms.get(session.roomCode) : null;
    const seat = room?.seats.find((s) => s && !s.isBot && !s.left && s.playerId === session.playerId);
    const spectator = room?.spectators.find((s) => s.playerId === session.playerId);
    if (!room || room.disposed || (!seat && !spectator) || !room.match) {
      lobbyPlayers++;
      if (room && !room.disposed && !room.match && (seat || spectator)) waitingRoomPlayers++;
      continue;
    }
    let group = rooms.get(room.code);
    if (!group) {
      group = { code: room.code, players: [], bots: room.seats.filter((s) => s && s.isBot && !s.left).length };
      rooms.set(room.code, group);
    }
    group.players.push({ playerId: session.playerId, name: session.name, role: spectator ? 'spectator' : 'player' });
  }
  for (const group of rooms.values()) group.players.sort((a, b) => a.playerId.localeCompare(b.playerId));
  return {
    onlinePlayers, lobbyPlayers, waitingRoomPlayers, inMatchPlayers: onlinePlayers - lobbyPlayers,
    rooms: [...rooms.values()].sort((a, b) => a.code.localeCompare(b.code)),
  };
}
