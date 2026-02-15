#!/usr/bin/env node

const { execSync } = require('child_process');

const portArg = process.argv[2];
const port = Number(portArg || process.env.PORT || 5000);

if (!Number.isFinite(port) || port <= 0) {
  console.error(`Invalid port: ${portArg}`);
  process.exit(1);
}

const isWin = process.platform === 'win32';

function run(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

function killPid(pid) {
  if (!pid) return;
  try {
    if (isWin) {
      run(`taskkill /PID ${pid} /F`);
    } else {
      run(`kill -9 ${pid}`);
    }
    console.log(`✓ Killed PID ${pid} (port ${port})`);
  } catch (e) {
    // best-effort
  }
}

try {
  if (isWin) {
    // netstat -ano output contains: TCP    0.0.0.0:5000   0.0.0.0:0   LISTENING   1234
    // Avoid findstr because it returns exit code 1 when no matches.
    const out = run('netstat -ano -p tcp');
    const pids = new Set();

    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!trimmed.includes(`:${port}`)) continue;
      if (!/LISTENING/i.test(trimmed)) continue;
      const parts = trimmed.split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    }

    if (pids.size === 0) {
      console.log(`✓ Port ${port} is free`);
      process.exit(0);
    }

    for (const pid of pids) killPid(pid);
    process.exit(0);
  }

  // macOS/Linux
  const out = run(`lsof -ti tcp:${port} 2>/dev/null || true`);
  const pids = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (pids.length === 0) {
    console.log(`✓ Port ${port} is free`);
    process.exit(0);
  }

  for (const pid of pids) killPid(pid);
  process.exit(0);
} catch (e) {
  // If netstat/lsof isn't available, don't fail dev start.
  console.warn(`⚠️  Could not check/kill port ${port}. Continuing.`);
  process.exit(0);
}
