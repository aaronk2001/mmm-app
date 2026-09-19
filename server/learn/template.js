'use strict';

// Whitelist-only Mustache-subset renderer for the Learn engine (Sprint D,
// Track 1). A lesson is DATA, not code — this module never evaluates a JS
// expression, never walks the prototype chain, and never does anything a
// lesson author couldn't already do by writing plain text. Anything beyond
// the two syntaxes below is a security defect, not a missing feature:
//
//   {{variable}}            -> variables[variable].formatted
//   {{variable.field}}      -> variables[variable][field], field one of
//                              value | formatted | grade | sample
//   {{#variable}}...{{/variable}}
//                            -> repeats the block once per item in
//                               variables[variable].value (must be an
//                               array); inside the block, {{field}} reads
//                               field directly off the current item
//                               (falls back to top-level lookup if the
//                               item doesn't own that field).
//
// No partials, no triple-stache/unescaped output, no inverted sections, no
// lambdas, no nested sections — none of these are used by real lesson
// content (verified against content/learn/**/*.md) and none are supported
// here. Interpolated values are HTML-escaped; only OWN properties are ever
// read (Object.prototype.hasOwnProperty), so a crafted `{{__proto__.x}}` or
// `{{constructor.x}}` tag cannot reach the prototype chain.

const ALLOWED_FIELDS = new Set(['value', 'formatted', 'grade', 'sample']);

// {{#name}}...{{/name}} — tag alone on its line has the trailing newline
// consumed (Mustache "standalone tag" convention), matching how real lesson
// content is authored (each tag on its own line).
const SECTION_RE = /\{\{#([a-zA-Z0-9_]+)\}\}\r?\n?([\s\S]*?)\{\{\/\1\}\}\r?\n?/g;
const SCALAR_RE = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

function getOwn(obj, key) {
  return obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderScalars(text, item, variables, missing) {
  return text.replace(SCALAR_RE, (full, path) => {
    const parts = path.split('.');
    let value;

    if (item && parts.length === 1 && Object.prototype.hasOwnProperty.call(item, parts[0])) {
      value = getOwn(item, parts[0]);
    } else {
      const root = getOwn(variables, parts[0]);
      if (root === undefined) {
        missing.push(path);
        return '';
      }
      if (parts.length === 1) {
        value = getOwn(root, 'formatted');
      } else if (parts.length === 2 && ALLOWED_FIELDS.has(parts[1])) {
        value = getOwn(root, parts[1]);
      } else {
        missing.push(path);
        return '';
      }
    }

    if (value === undefined || value === null) {
      missing.push(path);
      return '';
    }
    return escapeHtml(value);
  });
}

// render(template, variables) -> { html, missing }
//   template   raw lesson markdown/text containing {{...}} tags
//   variables  the object produced by learn/variables.js's computeVariables()
//   missing    list of tag paths that didn't resolve (unknown variable,
//              disallowed field, or a #section whose value isn't an array) —
//              used by scripts/build-learn-index.mjs to catch lesson
//              authoring typos without executing anything.
function render(template, variables = {}) {
  const missing = [];

  let out = String(template).replace(SECTION_RE, (full, key, inner) => {
    const root = getOwn(variables, key);
    if (!root || !Array.isArray(root.value)) {
      missing.push(`#${key}`);
      return '';
    }
    return root.value.map((item) => renderScalars(inner, item, variables, missing)).join('');
  });

  out = renderScalars(out, null, variables, missing);

  return { html: out, missing };
}

module.exports = { render };
