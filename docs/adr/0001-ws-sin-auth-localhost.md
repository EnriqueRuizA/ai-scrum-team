# ADR 0001 — WebSocket y API sin autenticación en localhost

Fecha: 2026-10-01. Estado: aceptado.

## Contexto

El dashboard (`index.html`) habla con el servidor por HTTP (`/api/*`) y
WebSocket (mismo puerto, sin token, sin comprobación de `Origin`). Cualquiera
que pueda abrir un socket contra el puerto puede leer logs/artefactos y lanzar
proyectos (`POST /api/start`).

## Decisión

No añadir auth mientras el servidor escuche en `127.0.0.1` por defecto
(`AI_SCRUM_BIND`, FASE 3): en esa configuración solo procesos de la propia
máquina pueden conectar, y el usuario es el operador. Se documenta en
`docs/SECURITY.md` y `CONTRIBUTING.md`.

## Consecuencias

- `AI_SCRUM_BIND=0.0.0.0` expone la API a la LAN **sin auth**: solo para
  red de confianza, nunca a internet sin reverse-proxy con auth delante.
- Si algún día se necesita multiusuario o exposición pública, este ADR se
  revoca y se añade token (p.ej. `Authorization: Bearer` generado al arrancar
  e inyectado en el dashboard servido).
- El rate-limit (FASE 3) mitiga abuso accidental, no sustituye auth.

## Alternativas descartadas

- Basic-auth siempre: fricción para herramienta local de un solo usuario;
  la contraseña acabaría en un fichero o en la URL del dashboard.
- Desactivar WS: el dashboard en tiempo real es el valor principal del proyecto.
