#!/usr/bin/env node
// Server-local administration. The installed wrapper serialises commands with flock.
import { randomBytes } from 'node:crypto';
import { chmodSync, chownSync, closeSync, fsyncSync, openSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readRoomKeys, roomKeysPath } from '../server/access/roomKeys.js';

function save(file, config) {
  const parent = statSync(dirname(file));
  const tmp = file + '.tmp-' + randomBytes(6).toString('hex');
  let fd;
  try {
    fd = openSync(tmp, 'wx', 0o640);
    writeFileSync(fd, JSON.stringify(config, null, 2) + '\n');
    chownSync(tmp, parent.uid, parent.gid);
    chmodSync(tmp, 0o640);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmp, file);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(tmp, { force: true });
  }
}

try {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) throw new Error('Run this command as root');
  const [command, value, ...extra] = process.argv.slice(2);
  if (extra.length || !['create', 'delete', 'list'].includes(command)
    || (command === 'list' && value !== undefined) || (command !== 'list' && !value)) {
    throw new Error('Usage: stronghold-keys create "备注" | delete KEY | list');
  }
  const file = roomKeysPath();
  const config = readRoomKeys(file);
  if (command === 'create') {
    const remark = value.trim();
    if (!remark || remark.length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(remark)) {
      throw new Error('Remark must contain 1–200 characters without control characters');
    }
    let key, id;
    do { key = randomBytes(9).toString('base64url'); } while (config.keys.some((entry) => entry.key === key));
    do { id = 'k_' + randomBytes(6).toString('hex'); } while (config.keys.some((entry) => entry.id === id));
    const entry = { id, key, remark, enabled: true, createdAt: new Date().toISOString() };
    config.keys.push(entry);
    save(file, config);
    console.log(JSON.stringify(entry, null, 2));
  } else if (command === 'delete') {
    const index = config.keys.findIndex((entry) => entry.key === value);
    if (index < 0) throw new Error('Key not found; configuration unchanged');
    const [entry] = config.keys.splice(index, 1);
    save(file, config);
    console.log(JSON.stringify({ deleted: true, id: entry.id, remark: entry.remark }));
  } else {
    // Raw keys are intentionally visible only to the root-only server command, never the HTTP report.
    console.log(JSON.stringify(config, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
