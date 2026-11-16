import { describe, expect, it } from 'vitest';
import { PRODUCT } from '../src/product.js';

describe('product identity', () => {
  it('matches confirmed decision D5', () => {
    expect(PRODUCT.name).toBe('Tariro Studio');
    expect(PRODUCT.projectExtension).toBe('.tsp');
    expect(PRODUCT.appId).toMatch(/^[a-z0-9.-]+$/);
  });
});
