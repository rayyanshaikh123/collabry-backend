/**
 * Port Killer Utility
 * Kills any process using the specified port before starting the server
 */

const { execSync } = require('child_process');

const isWin = process.platform === 'win32';

function run(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  } catch (e) {
    return '';
  }
}

function killPid(pid, port) {
  if (!pid) return false;
  try {
    if (isWin) {
      run(`taskkill /PID ${pid} /F`);
    } else {
      run(`kill -9 ${pid}`);
    }
    console.log(`✓ Killed process ${pid} using port ${port}`);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Kill any process using the specified port
 * @param {number} port - Port number to free up
 * @returns {Promise<boolean>} - True if port was freed, false if already free
 */
async function killPort(port) {
  if (!Number.isFinite(port) || port <= 0) {
    console.warn(`⚠️  Invalid port: ${port}`);
    return false;
  }

  try {
    if (isWin) {
      // Windows: Use netstat to find processes
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
        return false; // Port already free
      }

      let killed = false;
      for (const pid of pids) {
        if (killPid(pid, port)) {
          killed = true;
        }
      }
      
      // Wait a moment for port to be fully released
      if (killed) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      return killed;
    }

    // macOS/Linux: Use lsof
    const out = run(`lsof -ti tcp:${port} 2>/dev/null || true`);
    const pids = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (pids.length === 0) {
      return false; // Port already free
    }

    let killed = false;
    for (const pid of pids) {
      if (killPid(pid, port)) {
        killed = true;
      }
    }
    
    // Wait a moment for port to be fully released
    if (killed) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return killed;
  } catch (e) {
    console.warn(`⚠️  Could not check/kill port ${port}:`, e.message);
    return false;
  }
}

module.exports = { killPort };
