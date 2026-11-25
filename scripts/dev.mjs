import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
const cargo = fs.existsSync(`${os.homedir()}/.cargo/bin/cargo`)
  ? `${os.homedir()}/.cargo/bin/cargo`
  : 'cargo';
const children = [
  spawn(cargo, ['run', '--locked', '--release', '--bin', 'server'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.config.ts'], {
    stdio: 'inherit',
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((c) => c.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 100).unref();
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
children.forEach((c) => c.on('exit', (code) => stop(code || 0)));
