// server/routes/static.js - FASE 5: dashboard y estaticos (extraido de server.js).
const express = require('express');
const path = require('path');
const fs = require('fs-extra');

function registerStatic(app) {
  // IMPORTANTE: esta ruta debe ir ANTES de express.static('public').
  // Si no, GET / sirve public/index.html (vista compacta) y nunca ves el dashboard de raíz con Settings/pestañas.
  const sendDashboardRoot = (req, res) => {
    const rootDash = path.join(__dirname, '..', '..', 'index.html');
    const publicDash = path.join(__dirname, 'public', 'dashboard-local.html');
    fs.pathExists(rootDash)
      .then((existsRoot) => {
        if (existsRoot) return res.sendFile(rootDash);
        return fs.pathExists(publicDash).then((existsPub) => {
          if (existsPub) return res.sendFile(publicDash);
          return res.status(404).send('Dashboard no encontrado');
        });
      })
      .catch(() => {
        res.status(500).send('Error cargando el dashboard');
      });
  };

  app.get('/', sendDashboardRoot);

  // Sin esto, /index.html serviría public/index.html desde static (vista distinta al panel completo).
  app.get('/index.html', (req, res) => res.redirect(301, '/'));

  // Vista compacta antigua: explícita (evita confundirla con el panel completo)
  app.get('/simple', (req, res) => {
    const publicDash = path.join(__dirname, '..', '..', 'public', 'index.html');
    res.sendFile(publicDash, (err) => {
      if (err) res.status(404).send('Vista simple no encontrada');
    });
  });

  app.use(
    express.static('public', {
      index: false
    })
  );

}

module.exports = registerStatic;
