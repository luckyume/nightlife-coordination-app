import { spawn } from 'node:child_process';

const processes = [
  spawn(process.execPath, ['server.js'], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];

const stop = () => {
  for (const child of processes) if (!child.killed) child.kill('SIGTERM');
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of processes) child.on('exit', (code) => {
  if (code && code !== 0) process.exitCode = code;
  stop();
});
