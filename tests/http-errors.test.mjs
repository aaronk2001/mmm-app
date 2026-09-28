import { describe, it, expect } from 'vitest';
import mod from '../server/http-errors.js';

const { errorResponse } = mod;

describe('errorResponse', () => {
  it('maps not-found to 404 and keeps the message', () => {
    expect(errorResponse(new Error('Account not found'))).toEqual({ status: 404, message: 'Account not found' });
  });

  it('turns SQLite wording into plain language', () => {
    expect(errorResponse(new Error('FOREIGN KEY constraint failed'))).toMatchObject({ status: 400, message: expect.stringMatching(/doesn't exist/) });
    expect(errorResponse(new Error('NOT NULL constraint failed: accounts.type'))).toMatchObject({ status: 400, message: 'A required field is missing.' });
    expect(errorResponse(new Error('UNIQUE constraint failed: watchlist.symbol'))).toMatchObject({ status: 409 });
    expect(errorResponse(new Error('integer overflow'))).toMatchObject({ status: 400 });
  });

  it('honors an explicit status and otherwise the fallback', () => {
    const e = new Error('Invalid amount: 12abc'); e.status = 400;
    expect(errorResponse(e, 500)).toEqual({ status: 400, message: 'Invalid amount: 12abc' });
    expect(errorResponse(new Error('boom'), 500)).toEqual({ status: 500, message: 'boom' });
    expect(errorResponse(new Error('bad input'))).toEqual({ status: 400, message: 'bad input' });
  });
});
