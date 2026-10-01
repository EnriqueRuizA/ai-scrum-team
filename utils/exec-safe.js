// utils/exec-safe.js - FASE 2: spawn sin shell, con timeout y AbortSignal.
// El prompt SIEMPRE viaja como argumento, nunca interpolado en un shell.

const { spawn } = require('child_process');

class ExecTimeoutError extends Error {
  constructor(cmd, timeoutMs) {
    super(`${cmd} excedio el timeout (${timeoutMs} ms)`);
    this.code = 'EXEC_TIMEOUT';
  }
}

/**
 * @param {string} cmd - ejecutable (sin shell, sin interpolacion)
 * @param {string[]} args - argumentos (validados por el llamador)
 * @param {object} opts - { timeoutMs, signal, cwd, maxBuffer, env }
 * @returns {Promise<{stdout, stderr, code}>}
 */
function spawnSafe(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    if (typeof cmd !== 'string' || !cmd) {
      reject(new Error('Comando vacio no permitido'));
      return;
    }
    if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
      reject(new Error('Argumentos deben ser strings'));
      return;
    }
    const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : 0;
    const maxBuffer = opts.maxBuffer > 0 ? opts.maxBuffer : 10 * 1024 * 1024;

    let child;
    try {
      child = spawn(cmd, args, {
        shell: false,
        windowsHide: true,
        cwd: opts.cwd,
        env: opts.env || process.env
      });
    } catch (e) {
      reject(e);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    const done = (fn, val) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(val);
    };

    const onAbort = () => {
      try {
        child.kill('SIGKILL');
      } catch (e) {}
      done(reject, new Error(`${cmd} cancelado (abort)`));
    };

    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (e) {}
        done(reject, new ExecTimeoutError(cmd, timeoutMs));
      }, timeoutMs);
      if (timer.unref) timer.unref();
    }

    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
      if (stdout.length > maxBuffer) {
        try {
          child.kill('SIGKILL');
        } catch (e) {}
        done(reject, new Error(`${cmd} supero el buffer maximo (${maxBuffer} bytes)`));
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
      if (stderr.length > maxBuffer) stderr = stderr.slice(-maxBuffer);
    });
    child.on('error', (e) => {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      done(reject, e);
    });
    child.on('close', (code) => {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      done(resolve, { stdout, stderr, code: code ?? -1 });
    });
  });
}

module.exports = { spawnSafe, ExecTimeoutError };
