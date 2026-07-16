import { randomBytes } from 'node:crypto';

import {
  ContentKeyUnavailable,
  parseDataWrappingKeySet,
  parseWrappingKeySet,
} from './index';

describe('wrapping key set parser', () => {
  it('accepts active and grace reader keys', () => {
    const parsed = parseWrappingKeySet({
      schemaVersion: 1,
      activeVersion: 2,
      keys: [key(1), key(2)],
    });
    expect(parsed.activeVersion).toBe(2);
    expect([...parsed.keys.keys()]).toEqual([1, 2]);
  });

  it.each([
    { schemaVersion: 1, activeVersion: 2, keys: [key(1)] },
    { schemaVersion: 1, activeVersion: 1, keys: [{ ...key(1), extra: true }] },
    { schemaVersion: 1, activeVersion: 1, keys: [{ ...key(1), wrappingKey: 'invalid' }] },
    { schemaVersion: 2, activeVersion: 1, keys: [key(1)] },
  ])('fails closed for malformed input', (value) => {
    expect(() => parseWrappingKeySet(value)).toThrow(ContentKeyUnavailable);
  });

  it('zeroes already-decoded key material when a later key is malformed', () => {
    const fillSpy = jest.spyOn(Buffer.prototype, 'fill');
    try {
      expect(() =>
        parseWrappingKeySet({
          schemaVersion: 1,
          activeVersion: 2,
          keys: [key(1), { ...key(2), integrityKey: 'invalid' }],
        }),
      ).toThrow(ContentKeyUnavailable);
      expect(fillSpy).toHaveBeenCalledWith(0);
    } finally {
      fillSpy.mockRestore();
    }
  });
});

describe('data wrapping key set parser', () => {
  it('accepts only the wrapping-key projection', () => {
    const parsed = parseDataWrappingKeySet({
      schemaVersion: 1,
      activeVersion: 2,
      keys: [dataKey(1), dataKey(2)],
    });

    expect(parsed.activeVersion).toBe(2);
    expect([...parsed.keys.keys()]).toEqual([1, 2]);
  });

  it('rejects integrity material and unknown fields', () => {
    expect(() =>
      parseDataWrappingKeySet({
        schemaVersion: 1,
        activeVersion: 1,
        keys: [{ ...dataKey(1), integrityKey: randomBytes(32).toString('base64url') }],
      }),
    ).toThrow(ContentKeyUnavailable);
  });
});

function key(version: number) {
  return {
    version,
    wrappingKey: randomBytes(32).toString('base64url'),
    integrityKey: randomBytes(32).toString('base64url'),
  };
}

function dataKey(version: number) {
  return {
    version,
    wrappingKey: randomBytes(32).toString('base64url'),
  };
}
