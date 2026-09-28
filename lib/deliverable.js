const r = tryExec('npm test', { cwd: appDir, timeout: timeoutMs });
return { ran: true, ok: r.ok, message: r.ok ? undefined : (r.stderr || r.message || 'npm test falló'), stdout: r.stdout, stderr: r.stderr };
