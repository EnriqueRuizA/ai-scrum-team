// server.js - FASE 5: entrypoint delgado. App real en server/app.js.
const { createServer } = require('./server/app');

if (require.main === module) {
  let runtimeConfig = {};
  try {
    runtimeConfig = require('./config/project-config.json');
  } catch (e) {}
  // FASE 3: puerto validado como entero (evita inyeccion en el auto-open).
  const rawPort = process.env.PORT || runtimeConfig.outputs?.port || 3000;
  const PORT = Number.parseInt(String(rawPort), 10);
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    console.error(`[ERROR] Puerto invalido: ${String(rawPort).slice(0, 50)}`);
    process.exit(1);
  }

  const { start } = createServer();
  start(PORT)
    .then(() => {
      console.log(`
╔═══════════════════════════════════════════════╗
║         AI SCRUM TEAM ORCHESTRATOR            ║
║                                               ║
║  Dashboard: http://localhost:${PORT}              ║
║                                               ║
║  1. Configura credenciales en Settings        ║
║  2. Ajusta el proyecto si necesitas           ║
║  3. Pulsa «Iniciar proyecto» en el dashboard  ║
╚═══════════════════════════════════════════════╝
  `);

      const config = require('./config/project-config.json');
      if (config.outputs?.autoOpenDashboard) {
        const url = `http://localhost:${PORT}`;
        const open = () => {
          const { exec } = require('child_process');
          if (process.platform === 'win32') {
            exec(`start "" "${url}"`, { windowsHide: true }, () => {});
          } else if (process.platform === 'darwin') {
            exec(`open "${url}"`, () => {});
          } else {
            exec(`xdg-open "${url}"`, () => {});
          }
        };
        setTimeout(open, 1000);
      }
    })
    .catch((err) => {
      if (err && err.code === 'EADDRINUSE') {
        console.error(`\n[ERROR] El puerto ${PORT} ya está en uso.`);
        console.error(`[SOLUCIÓN] Cierra el otro proceso (otro 'node server.js') o cambia "outputs.port" en config/project-config.json.\n`);
        process.exit(1);
      }
      console.error(err);
      process.exit(1);
    });
}

module.exports = { createServer };


module.exports = { createServer };
