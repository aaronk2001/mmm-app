// Research page logic that decides what the user can see and pick.
import { describe, it, expect } from 'vitest';
import { pickerOptions, citationParts, failureCopy } from '../src/components/money/sections/parts/research/logic.js';

const b = (id, available) => ({ id, label: id, available, model: available ? 'm' : null });

describe('pickerOptions', () => {
  it('hidden when only local Ollama is usable', () => {
    expect(pickerOptions([b('ollama', true), b('claude', false), b('openai', false)])).toEqual([]);
  });

  it('shown, with Ollama listed (even when down), as soon as one cloud backend is usable', () => {
    const opts = pickerOptions([b('ollama', false), b('claude', true), b('openai', false)]);
    expect(opts.map((o) => [o.id, o.disabled])).toEqual([['ollama', true], ['claude', false]]);
  });
});

describe('citationParts', () => {
  const calls = [{ n: 1 }, { n: 2 }];
  it('splits text and known citations', () => {
    expect(citationParts('A [1] b [2].', calls)).toEqual([
      { text: 'A ' }, { call: calls[0] }, { text: ' b ' }, { call: calls[1] }, { text: '.' },
    ]);
  });

  it('keeps a citation that points at no tool call, marked as missing', () => {
    expect(citationParts('X [4].', calls)).toEqual([{ text: 'X ' }, { missing: 4 }, { text: '.' }]);
  });
});

describe('failureCopy', () => {
  it('names the cloud backend that failed and passes its error through', () => {
    expect(failureCopy({ backend: 'claude', error: 'cloud model unavailable' })).toMatch(/Claude.*check the key/i);
    expect(failureCopy({ backend: 'openai', error: 'x' })).toMatch(/OpenAI-compatible.*URL/i);
  });

  it('local failures point at Ollama', () => {
    expect(failureCopy({ backend: 'ollama', error: 'This operation was aborted' })).toMatch(/Ollama/);
  });
});
