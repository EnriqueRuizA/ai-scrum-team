/**
 * Extrae y parsea JSON de respuestas de LLM que suelen venir con:
 * - Bloques Markdown ```json ... ``` (a veces sin cerrar)
 * - Varios fences; el primero puede ser un ``` vacío o de otro lenguaje
 * - Texto antes/después del JSON
 * - Objetos anidados (regex \{[\s\S]*?\} falla)
 * - Comas finales ocasionales
 */

/**
 * @param {string} str
 * @param {number} braceIndex índice del primer "{" del objeto raíz
 * @returns {string|null}
 */
function extractBalancedObject(str, braceIndex) {
  if (braceIndex < 0 || braceIndex >= str.length || str[braceIndex] !== '{') {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = braceIndex; i < str.length; i++) {
    const c = str[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }

    if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        return str.slice(braceIndex, i + 1);
      }
    }
  }

  return null;
}

/**
 * @param {string} str
 * @param {number} start index of "["
 */
function extractBalancedArray(str, start) {
  if (start < 0 || str[start] !== '[') return null;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < str.length; i++) {
    const c = str[i];

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }

    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Quita BOM y espacios.
 * @param {string} text
 */
function normalizeLlmText(text) {
  let t = text.trim();
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return t;
}

/**
 * Índices tras cada apertura de fence (para no depender del primer ``` erróneo).
 * @param {string} text
 * @returns {number[]}
 */
function allMarkdownFenceEndIndices(text) {
  const set = new Set();

  const reJson = /```(?:json|JSON)\s*\r?\n?/g;
  let m;
  while ((m = reJson.exec(text)) !== null) {
    set.add(m.index + m[0].length);
  }

  // ```\n o ```\r\n (bloque genérico; no coincide ```json\n porque tras ``` no hay solo espacios antes del salto)
  const rePlain = /```\s*\r?\n/g;
  while ((m = rePlain.exec(text)) !== null) {
    set.add(m.index + m[0].length);
  }

  set.add(0);
  return [...set].sort((a, b) => a - b);
}

/**
 * @param {string} slice
 * @returns {object|array|null}
 */
function parseSliceWithRepair(slice) {
  try {
    return JSON.parse(slice);
  } catch {
    try {
      const fixed = slice.replace(/,(\s*[}\]])/g, '$1');
      if (fixed !== slice) return JSON.parse(fixed);
    } catch {
      /* ignore */
    }
    return null;
  }
}

/**
 * Prueba cada "{" o "[" desde `from` en orden; primer JSON válido gana.
 * @param {string} text
 * @param {number} from
 * @returns {object|array|null}
 */
function tryParseBalancedJsonFrom(text, from) {
  if (from < 0) from = 0;
  if (from >= text.length) return null;

  for (let pos = from; pos < text.length; ) {
    const openBrace = text.indexOf('{', pos);
    const openBracket = text.indexOf('[', pos);

    let next = -1;
    let useBrace = false;
    if (openBrace !== -1 && openBracket !== -1) {
      if (openBrace <= openBracket) {
        next = openBrace;
        useBrace = true;
      } else {
        next = openBracket;
        useBrace = false;
      }
    } else if (openBrace !== -1) {
      next = openBrace;
      useBrace = true;
    } else if (openBracket !== -1) {
      next = openBracket;
      useBrace = false;
    } else {
      break;
    }

    const slice = useBrace
      ? extractBalancedObject(text, next)
      : extractBalancedArray(text, next);

    if (slice) {
      const parsed = parseSliceWithRepair(slice);
      if (parsed !== null) return parsed;
    }
    pos = next + 1;
  }
  return null;
}

/**
 * Posición tras el primer fence ```json (preferido) o ``` genérico.
 * Compatibilidad con tests y llamadas que esperan “un” fence.
 * @param {string} text
 * @returns {number}
 */
function indexAfterMarkdownFence(text) {
  const mJson = text.match(/```(?:json|JSON)\s*\r?\n?/);
  if (mJson && mJson.index !== undefined) {
    return mJson.index + mJson[0].length;
  }
  const mAny = text.match(/```\s*\r?\n?/);
  if (mAny && mAny.index !== undefined) {
    return mAny.index + mAny[0].length;
  }
  return 0;
}

/**
 * @param {string} text
 * @returns {object|array|null}
 */
function parseLlmJsonResponse(text) {
  if (text == null || typeof text !== 'string') return null;

  const t = normalizeLlmText(text);
  if (!t) return null;

  const roots = allMarkdownFenceEndIndices(t);
  const nonZero = roots.filter((r) => r > 0);
  const ordered = nonZero.length ? [...nonZero, 0] : [0];

  for (const from of ordered) {
    const parsed = tryParseBalancedJsonFrom(t, from);
    if (parsed !== null) return parsed;
  }

  return null;
}

module.exports = {
  parseLlmJsonResponse,
  extractBalancedObject,
  extractBalancedArray,
  indexAfterMarkdownFence,
  allMarkdownFenceEndIndices,
  tryParseBalancedJsonFrom
};
