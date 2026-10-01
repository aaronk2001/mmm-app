// Pure helpers for the Research page (kept out of the JSX so they're testable).

// The model picker appears as soon as any cloud backend is usable — even when
// local Ollama is down — and always lists Ollama so the default stays visible.
export function pickerOptions(backends = []) {
  const cloud = backends.filter((b) => b.id !== 'ollama' && b.available);
  if (!cloud.length) return [];
  const local = backends.find((b) => b.id === 'ollama');
  return [
    ...(local ? [{ ...local, disabled: !local.available }] : []),
    ...cloud.map((b) => ({ ...b, disabled: false })),
  ];
}

// "[n]" markers → the tool call they cite. A marker pointing at no call is
// kept (as `missing`) so a fabricated citation stays visible.
export function citationParts(text, calls) {
  return String(text).split(/\[(\d+)\]/g).map((p, i) => {
    if (i % 2 === 0) return { text: p };
    const call = calls.find((c) => c.n === Number(p));
    return call ? { call } : { missing: Number(p) };
  }).filter((p) => !('text' in p) || p.text !== '');
}

export function failureCopy({ backend, error }) {
  const detail = error ? ` (${error})` : '';
  if (backend === 'claude') return `The Claude call failed${detail}. Check the key in Settings → Online & Keys and the model name in Settings → Research.`;
  if (backend === 'openai') return `The OpenAI-compatible call failed${detail}. Check the URL, model and key in Settings → Research and Online & Keys.`;
  return `The local model call failed${detail}. Check that Ollama is running, or try a narrower question.`;
}
