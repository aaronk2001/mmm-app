// Safe arithmetic expression evaluator over a whitelisted variable scope.
// Supports + - * / %, parentheses, unary +/-, decimal numbers, and bare
// identifiers resolved from `scope`. No eval, no function calls, no property
// access — only numbers come out, so user formulas can never run code.

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const isDigit = (c) => c >= '0' && c <= '9';
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if ('()+-*/%'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      let j = i + 1;
      while (j < src.length && (isDigit(src[j]) || src[j] === '.')) j++;
      tokens.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
      i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ t: 'id', v: src.slice(i, j) });
      i = j; continue;
    }
    throw new Error(`Unexpected character "${c}"`);
  }
  return tokens;
}

function parse(tokens, scope) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function expr() {
    let v = term();
    while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = next().v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = factor();
    while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/' || peek().v === '%')) {
      const op = next().v;
      const r = factor();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function factor() {
    const tk = peek();
    if (!tk) throw new Error('Unexpected end of formula');
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '+')) {
      next();
      const v = factor();
      return tk.v === '-' ? -v : v;
    }
    if (tk.t === 'op' && tk.v === '(') {
      next();
      const v = expr();
      if (!peek() || peek().v !== ')') throw new Error('Missing ")"');
      next();
      return v;
    }
    if (tk.t === 'num') { next(); return tk.v; }
    if (tk.t === 'id') {
      next();
      if (!(tk.v in scope)) throw new Error(`Unknown variable "${tk.v}"`);
      const val = Number(scope[tk.v]);
      if (!Number.isFinite(val)) throw new Error(`"${tk.v}" is not a number`);
      return val;
    }
    throw new Error('Unexpected token');
  }

  const result = expr();
  if (pos !== tokens.length) throw new Error('Unexpected trailing input');
  return result;
}

// Returns { value: number|null, error: string|null }. Empty input → both null.
export function evalFormula(src, scope = {}) {
  try {
    if (!src || !src.trim()) return { value: null, error: null };
    const tokens = tokenize(src);
    if (!tokens.length) return { value: null, error: null };
    const value = parse(tokens, scope);
    if (!Number.isFinite(value)) return { value: null, error: 'Result is not a finite number' };
    return { value, error: null };
  } catch (e) {
    return { value: null, error: e.message };
  }
}
