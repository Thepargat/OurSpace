import { describe, it, expect } from 'vitest';
import { cn } from '../utils';

describe('cn', () => {
  it('returns a single class unchanged', () => {
    expect(cn('foo')).toBe('foo');
  });

  it('merges multiple classes', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('handles conditional classes (truthy)', () => {
    expect(cn('base', true && 'active')).toBe('base active');
  });

  it('omits falsy conditional classes', () => {
    expect(cn('base', false && 'hidden')).toBe('base');
    expect(cn('base', undefined)).toBe('base');
    expect(cn('base', null)).toBe('base');
  });

  it('deduplicates conflicting tailwind classes (last wins)', () => {
    // tailwind-merge resolves conflicts: p-2 wins over p-4
    expect(cn('p-4', 'p-2')).toBe('p-2');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('handles object syntax', () => {
    expect(cn({ foo: true, bar: false })).toBe('foo');
    expect(cn({ a: true, b: true })).toBe('a b');
  });

  it('handles array syntax', () => {
    expect(cn(['x', 'y'])).toBe('x y');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });
});
