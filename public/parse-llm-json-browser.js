/**
 * Misma lógica que lib/parse-llm-json.js — mantener alineado.
 * Expone window.parseLlmJsonResponse para el dashboard (vista Lectura / artefactos).
 */
(function (global) {
  'use strict';

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

  function normalizeLlmText(text) {
    let t = text.trim();
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    return t;
  }

  function allMarkdownFenceEndIndices(text) {
    const set = new Set();

    const reJson = /```(?:json|JSON)\s*\r?\n?/g;
    let m;
    while ((m = reJson.exec(text)) !== null) {
      set.add(m.index + m[0].length);
    }

    const rePlain = /```\s*\r?\n/g;
    while ((m = rePlain.exec(text)) !== null) {
      set.add(m.index + m[0].length);
    }

    set.add(0);
    return [...set].sort((a, b) => a - b);
  }

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

  global.parseLlmJsonResponse = parseLlmJsonResponse;
})(typeof window !== 'undefined' ? window : globalThis);
