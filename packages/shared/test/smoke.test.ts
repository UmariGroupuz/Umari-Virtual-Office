import { describe, expect, it } from 'vitest';
import * as shared from '@vo/shared';

describe('@vo/shared smoke', () => {
  it('resolves the workspace package from its TypeScript source', () => {
    expect(shared).toBeTypeOf('object');
    expect(shared).not.toBeNull();
  });
});
