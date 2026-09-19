'use strict';

// The look-ahead guard. `currentIndex` is the index of the bar a decision is
// about to fill INTO (see engine.js): a strategy may see bars[0..currentIndex-1]
// in full (they are complete, historical bars) but bar[currentIndex] and
// anything beyond it is not yet knowable, so any attempt to read it — by
// index, by iteration, or through an Array.prototype method reached via the
// proxy — throws LookAheadError. It never falls back to `undefined` or `NaN`:
// a silently-missing value is exactly how a look-ahead bug hides inside an
// otherwise "clean" backtest.

class LookAheadError extends Error {
  constructor(index, currentIndex) {
    super(`look-ahead violation: bar index ${index} is not visible yet (currentIndex=${currentIndex})`);
    this.name = 'LookAheadError';
    this.index = index;
    this.currentIndex = currentIndex;
  }
}

/**
 * @param {Array<object>} bars  full chronological bar array (only reachable
 *   from the caller through the returned proxy, never directly).
 * @param {number} currentIndex  index of the bar this decision will fill into;
 *   bars strictly before it are visible, it and everything after it are not.
 * @returns {{currentIndex: number, length: number, bar: function(number): object, bars: Array<object>}}
 */
function createBarView(bars, currentIndex) {
  if (!Array.isArray(bars)) throw new TypeError('createBarView: bars must be an array');
  if (!Number.isInteger(currentIndex) || currentIndex < 0) {
    throw new TypeError(`createBarView: currentIndex must be a non-negative integer, got ${currentIndex}`);
  }

  function guardIndex(rawProp) {
    const idx = Number(rawProp);
    if (!Number.isInteger(idx) || idx < 0 || idx >= currentIndex) {
      throw new LookAheadError(idx, currentIndex);
    }
    return idx;
  }

  const proxy = new Proxy(bars, {
    get(target, prop, receiver) {
      if (prop === 'length') return currentIndex;
      if (prop === Symbol.iterator) {
        return function* () { for (let i = 0; i < currentIndex; i++) yield target[i]; };
      }
      if (typeof prop === 'string' && /^\d+$/.test(prop)) return target[guardIndex(prop)];
      // Non-index reads (array methods like slice/map/forEach, etc.) run with
      // `receiver` bound to this proxy, so any index access they perform
      // internally (via `this[i]`) is still routed back through this trap.
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) return Number(prop) < currentIndex;
      return Reflect.has(target, prop);
    },
    set() {
      throw new Error('backtest bar view is read-only');
    },
    // Descriptor reads (Object.getOwnPropertyDescriptor(s), spread, JSON
    // stringification's key enumeration, for..in) bypass `get`/`has` and hit
    // the raw target unless trapped here too — that was the look-ahead hole:
    // Object.getOwnPropertyDescriptor(view.bars, futureIndex) read the real
    // element straight off `bars` because this trap didn't exist.
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) guardIndex(prop);
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    // Must agree with getOwnPropertyDescriptor to satisfy the proxy
    // invariants against a non-configurable-length target: ownKeys reports
    // only the visible indices + 'length', and every one of those keys has a
    // descriptor (the length descriptor is delegated to the real target,
    // whose own 'length' is always the true underlying array length so it
    // stays configurable/writable-consistent with what Reflect reports).
    ownKeys(target) {
      const keys = [];
      for (let i = 0; i < currentIndex; i++) keys.push(String(i));
      keys.push('length');
      return keys;
    },
    deleteProperty() {
      throw new Error('backtest bar view is read-only');
    },
    defineProperty() {
      throw new Error('backtest bar view is read-only');
    },
  });

  return {
    currentIndex,
    length: currentIndex,
    bar(i) { return proxy[i]; },
    bars: proxy,
  };
}

/**
 * Multi-symbol wrapper around createBarView — one guarded view per symbol,
 * sharing a single currentIndex (the caller must keep symbol calendars
 * aligned; engine.js enforces this before building any view).
 * @param {Object<string, Array<object>>} barsBySymbol
 * @param {string[]} symbols
 * @param {number} currentIndex
 * @returns {{currentIndex: number, length: number, symbols: string[], bar: function(string, number): object, bars: Object<string, Array<object>>}}
 */
function createUniverseView(barsBySymbol, symbols, currentIndex) {
  const singleViews = {};
  const bars = {};
  for (const s of symbols) {
    const v = createBarView(barsBySymbol[s], currentIndex);
    singleViews[s] = v;
    bars[s] = v.bars;
  }
  return {
    currentIndex,
    length: currentIndex,
    symbols: [...symbols],
    bar(symbol, i) { return singleViews[symbol].bar(i); },
    bars,
  };
}

module.exports = { createBarView, createUniverseView, LookAheadError };
