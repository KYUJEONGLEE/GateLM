import type { AdmissionHandle } from '@/execution/execution.types';

import { ActiveTurnRegistry } from './active-turn-registry';

describe('ActiveTurnRegistry', () => {
  it('tracks concurrent attachments independently and aborts the logical turn together', () => {
    const registry = new ActiveTurnRegistry();
    const first = handle('first');
    const second = handle('second');
    const firstSignal = registry.register('turn', first);
    const secondSignal = registry.register('turn', second);
    registry.release('turn', first);
    expect(firstSignal).toBe(secondSignal);
    expect(registry.abort('turn')).toEqual([second]);
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(true);
  });
});

function handle(value: string): AdmissionHandle {
  return Object.freeze({ admissionId: value } as AdmissionHandle);
}
