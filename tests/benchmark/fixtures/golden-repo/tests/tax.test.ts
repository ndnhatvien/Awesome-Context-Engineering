import { computeTax } from './tax.js';

describe('tax', () => {
  it('applies a flat 10% rate', () => {
    expect(computeTax(1000)).toBe(100);
  });
});