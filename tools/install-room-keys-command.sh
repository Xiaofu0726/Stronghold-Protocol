#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo 'Please run as root' >&2; exit 1; }
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
node_bin=$(command -v node)
command -v flock >/dev/null
getent group stronghold >/dev/null
config=${SP_ROOM_KEYS_FILE:-/etc/stronghold/room-keys.json}
[[ "$config" = /* ]] || { echo 'SP_ROOM_KEYS_FILE must be an absolute path' >&2; exit 1; }
config_dir=$(dirname -- "$config")
if [[ ! -d "$config_dir" ]]; then
  install -d -o root -g stronghold -m 0750 -- "$config_dir"
fi
[[ $(stat -c %G -- "$config_dir") = stronghold ]] || {
  echo "Configuration directory must belong to group stronghold: $config_dir" >&2; exit 1;
}
if [[ -e "$config" ]]; then
  chown root:stronghold -- "$config"
  chmod 0640 -- "$config"
fi
wrapper=$(mktemp /usr/local/bin/.stronghold-keys.XXXXXX)
trap 'rm -f -- "$wrapper"' EXIT
{
  printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail'
  printf '%s\n' '[[ $(id -u) -eq 0 ]] || { echo "Please run as root" >&2; exit 1; }'
  printf 'export SP_ROOM_KEYS_FILE=%q\n' "$config"
  printf 'exec flock /run/lock/stronghold-room-keys.lock %q %q "$@"\n' "$node_bin" "$repo/tools/room-keys.mjs"
} > "$wrapper"
chmod 0750 "$wrapper"
mv -f -- "$wrapper" /usr/local/bin/stronghold-keys
echo 'Installed: stronghold-keys create "备注" | delete KEY | list'
echo "Configuration: $config"
