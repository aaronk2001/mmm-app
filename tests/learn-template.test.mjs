import { describe, it, expect } from 'vitest';
import { render } from '../server/learn/template.js';

const VARS = {
  runway_days: { value: 42, formatted: '42 days', grade: 'A', sample: false },
  budget_variance_top3: {
    value: [
      { category_id: 'fod', name: 'Food', formatted: '$140 over' },
      { category_id: 'hou', name: 'Housing', formatted: '$20 under' },
    ],
    formatted: 'Food: $140 over; Housing: $20 under',
    grade: 'A',
    sample: false,
  },
};

describe('learn/template — scalar substitution', () => {
  it('bare {{var}} defaults to .formatted', () => {
    expect(render('Runway: {{runway_days}}', VARS).html).toBe('Runway: 42 days');
  });
  it('{{var.field}} reads an allowed field', () => {
    expect(render('{{runway_days.value}} / {{runway_days.grade}}', VARS).html).toBe('42 / A');
  });
  it('rejects a disallowed field (never touches arbitrary object keys)', () => {
    const { html, missing } = render('{{runway_days.__proto__}}', VARS);
    expect(html).toBe('');
    expect(missing).toContain('runway_days.__proto__');
  });
  it('reports an unknown variable as missing instead of throwing', () => {
    const { html, missing } = render('{{not_a_real_variable}}', VARS);
    expect(html).toBe('');
    expect(missing).toContain('not_a_real_variable');
  });

  // Minor fixes: an object-valued `.value` field and a stray-whitespace tag
  // both used to render silently-wrong output (`[object Object]` / the
  // literal `{{ liquid }}` braces) with nothing surfaced in `missing` for
  // check:learn-content to catch.
  it('reports an object-valued field (e.g. debt_ledger.value) as missing instead of rendering [object Object]', () => {
    const vars = { debt_ledger: { value: [{ lender: 'Visa', apr: 24 }], formatted: '1 debt', grade: 'B', sample: false } };
    const { html, missing } = render('{{debt_ledger.value}}', vars);
    expect(html).toBe('');
    expect(html).not.toContain('[object Object]');
    expect(missing).toContain('debt_ledger.value');
  });

  it('reports a tag with stray inner whitespace (e.g. {{ liquid }}) as missing instead of leaving it unrendered', () => {
    const { html, missing } = render('You have {{ liquid }} on hand.', VARS);
    expect(html).toBe('You have  on hand.');
    expect(html).not.toContain('{{');
    expect(missing).toContain('liquid');
  });

  it('a well-formed tag with no inner whitespace still renders normally', () => {
    expect(render('{{runway_days}}', VARS).html).toBe('42 days');
  });
});

describe('learn/template — sections (array iteration)', () => {
  const tpl = '{{#budget_variance_top3}}\n- **{{name}}** — {{formatted}}\n{{/budget_variance_top3}}';
  it('iterates variables[key].value and exposes each item field', () => {
    const { html, missing } = render(tpl, VARS);
    expect(html).toBe('- **Food** — $140 over\n- **Housing** — $20 under\n');
    expect(missing).toEqual([]);
  });
  it('a section over a non-array variable resolves to nothing and is reported missing', () => {
    const { html, missing } = render('{{#runway_days}}x{{/runway_days}}', VARS);
    expect(html).toBe('');
    expect(missing).toContain('#runway_days');
  });
  it('an empty array renders zero iterations, not an error', () => {
    const empty = { budget_variance_top3: { value: [], formatted: '', grade: 'C', sample: true } };
    expect(render(tpl, empty).html).toBe('');
  });
});

describe('learn/template — security: executes nothing, escapes output', () => {
  it('never reaches the prototype chain via __proto__/constructor tags', () => {
    const vars = { x: { value: 1, formatted: '1' } };
    expect(render('{{__proto__}}', vars).html).toBe('');
    expect(render('{{constructor}}', vars).html).toBe('');
  });
  it('HTML-escapes an interpolated value (e.g. a payee name with special chars)', () => {
    const vars = { largest_outflow: { value: {}, formatted: `<script>alert('x')</script> & Co` } };
    const { html } = render('{{largest_outflow}}', vars);
    expect(html).not.toContain('<script>');
    expect(html).toBe('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; Co');
  });
  it('leaves an unsupported tag syntax (partial) inert, not executed', () => {
    // {{> partial}} is not part of the supported syntax — `>` and the space
    // aren't in the scalar tag charset, so it passes through untouched
    // rather than being interpolated or evaluated as a file include.
    const { html } = render('{{> some_partial}}', VARS);
    expect(html).toBe('{{> some_partial}}');
  });
  it('a triple-stache is not treated as raw/unescaped output — the inner tag is still escaped and missing-checked', () => {
    // {{{raw}}} isn't supported "unescaped" syntax; the outer braces are
    // literal text and the inner {{raw}} is processed as an ordinary
    // (unknown, still-escaped) scalar tag — never as a raw/unescaped pass-
    // through, which is the property that matters for security.
    const { html, missing } = render('{{{raw}}}', VARS);
    expect(html).toBe('{}');
    expect(missing).toContain('raw');
  });
});
