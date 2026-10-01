# AI Scrum Team — Uso local (sin nube de pago)

> Documento corto. La guía completa está en [`README.md`](README.md) y el uso
> día a día en [`docs/GUIA-USO.md`](docs/GUIA-USO.md).

Todo funciona con **modelos gratuitos**: Ollama en tu PC y/o modelos free de
opencode. No necesitas API keys de OpenAI ni de Claude.

## Requisitos

- Node.js >= 20
- [opencode](https://opencode.ai) instalado (`opencode --version` responde)
- [Ollama](https://ollama.com) con al menos un modelo, p.ej.:
  `ollama pull qwen3.5:9b` (o usa un modelo cloud `opencode/*-free`)

## Arranque

```bat
START.bat
```

Eso ejecuta el preflight (`node setup.js`: config válida, motor, modelo),
levanta `opencode serve` solo si tu modo es `serve`, y abre
http://127.0.0.1:3000.

1. Mira el pill **Motor** (debe decir OK).
2. Revisa **Agentes** (roles + flujo clásico por defecto) si quieres cambiar algo.
3. Pulsa **Iniciar**.

## Notas

- Sin credenciales en el proyecto: la auth vive en opencode
  (`opencode auth login` solo si usas modelos cloud con login).
- Para parar: `STOP.bat` (añade `--with-engine` para parar también el serve).
- Si algo falla, mira [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).
