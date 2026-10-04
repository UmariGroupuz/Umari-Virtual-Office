import { describe, expect, it } from 'vitest';
import * as shared from '../index';
import * as adapters from './index';

describe('adapters public surface (API_CONTRACTS §5.3)', () => {
  it.each([
    'AdapterError',
    'claudeCodeEventSchema',
    'mapClaudeToolToAction',
    'claudeCodeAdapter',
    'PRODUCER_ADAPTERS',
  ] as const)('%s is exported from the adapters module and from @vo/shared', (name) => {
    expect(adapters[name]).toBeDefined();
    expect(shared[name]).toBe(adapters[name]);
  });

  it('exports exactly the contracted runtime names', () => {
    expect(Object.keys(adapters).sort()).toEqual(
      [
        'AdapterError',
        'PRODUCER_ADAPTERS',
        'claudeCodeAdapter',
        'claudeCodeEventSchema',
        'mapClaudeToolToAction',
      ].sort(),
    );
  });
});

describe('PRODUCER_ADAPTERS registry', () => {
  it('maps "claude-code" to claudeCodeAdapter and nothing else', () => {
    expect(Object.keys(adapters.PRODUCER_ADAPTERS)).toEqual(['claude-code']);
    expect(adapters.PRODUCER_ADAPTERS['claude-code']).toBe(adapters.claudeCodeAdapter);
  });

  it('every adapter key equals its source', () => {
    for (const [key, adapter] of Object.entries(adapters.PRODUCER_ADAPTERS)) {
      expect(adapter.source).toBe(key);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(adapters.PRODUCER_ADAPTERS)).toBe(true);
  });

  it('has no inherited keys (safe lookup by an untrusted source name)', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'unknown']) {
      expect(adapters.PRODUCER_ADAPTERS[name]).toBeUndefined();
    }
  });

  it('a registry lookup maps the §19 example through the unknown-typed interface', () => {
    const adapter = adapters.PRODUCER_ADAPTERS['claude-code'];
    expect(adapter).toBeDefined();
    const output = adapter?.toCanonical({
      source: 'claude-code',
      agentId: '04-backend-engineer',
      event: 'tool.executed',
      tool: 'Edit',
    });
    expect(output).toEqual([
      expect.objectContaining({ type: 'agent.activity', action: 'edit_file', message: 'Edit' }),
    ]);
  });

  it('AdapterError carries a code and is an Error', () => {
    const error = new adapters.AdapterError('UNSUPPORTED_EVENT', 'nope');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('UNSUPPORTED_EVENT');
    expect(error.message).toBe('nope');
    expect(error.name).toBe('AdapterError');
  });
});
