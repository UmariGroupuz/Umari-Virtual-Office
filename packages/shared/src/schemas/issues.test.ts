import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toValidationIssues } from './issues';

describe('toValidationIssues', () => {
  it('maps paths (dot-joined) and messages', () => {
    const schema = z.object({ a: z.object({ b: z.array(z.number()) }) });
    const result = schema.safeParse({ a: { b: [1, 'x'] } });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(toValidationIssues(result.error)).toEqual([
      { path: 'a.b.1', message: 'Invalid input: expected number, received string' },
    ]);
  });

  it('expands unrecognized_keys into one issue per key, prefixed by the parent path', () => {
    const schema = z.strictObject({ inner: z.strictObject({ x: z.number() }) });
    const result = schema.safeParse({ inner: { x: 1, y: 2, z: 3 }, top: true });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(toValidationIssues(result.error)).toEqual(
      expect.arrayContaining([
        { path: 'inner.y', message: 'Unrecognized key' },
        { path: 'inner.z', message: 'Unrecognized key' },
        { path: 'top', message: 'Unrecognized key' },
      ]),
    );
    expect(toValidationIssues(result.error)).toHaveLength(3);
  });

  it('uses "" for root issues', () => {
    const result = z.string().safeParse(1);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(toValidationIssues(result.error)[0]?.path).toBe('');
  });

  it('keeps custom messages verbatim', () => {
    const result = z
      .string()
      .refine(() => false, { message: 'Custom text' })
      .safeParse('x');
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(toValidationIssues(result.error)).toEqual([{ path: '', message: 'Custom text' }]);
  });
});
