# generar_mapa.py
from pathlib import Path
from aider.repomap import RepoMap
from aider.models import Model
from aider.io import InputOutput

RAIZ = Path(".").resolve()
SALIDA = RAIZ / "GRAPH_MAP.md"
IGNORAR = {".git", "node_modules", "venv", ".venv", "__pycache__", "dist"}
EXT = {".py", ".js", ".ts", ".tsx", ".java", ".cs", ".go", ".rs", ".php"}

ficheros = [
    str(p) for p in RAIZ.rglob("*")
    if p.is_file() and p.suffix in EXT
    and not IGNORAR.intersection(p.relative_to(RAIZ).parts)
]

rm = RepoMap(
    map_tokens=4096,             # sube o baja el detalle
    root=str(RAIZ),
    main_model=Model("gpt-4o"),  # solo se usa para contar tokens
    io=InputOutput(),
    refresh="always",
)

mapa = rm.get_repo_map(chat_files=[], other_files=ficheros)

SALIDA.parent.mkdir(exist_ok=True)
SALIDA.write_text("# Mapa del repositorio\n\n```\n" + (mapa or "") + "\n```\n",
                  encoding="utf-8")
print(f"Mapa guardado en {SALIDA}")