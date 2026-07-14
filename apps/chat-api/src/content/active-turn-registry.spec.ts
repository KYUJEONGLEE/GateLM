import type { AdmissionHandle } from '@/execution/execution.types';

import { ActiveTurnRegistry, TurnAttachmentLimitReached } from './active-turn-registry';

describe('ActiveTurnRegistry', () => {
  it('tracks concurrent attachments independently and aborts the logical turn together', () => {
    const registry = new ActiveTurnRegistry();
    const first = handle('first');
    const second = handle('second');
    const firstSignal = registry.register('turn', first, 2);
    const secondSignal = registry.register('turn', second, 2);
    registry.release('turn', first);
    expect(firstSignal).toBe(secondSignal);
    expect(registry.abort('turn')).toEqual([second]);
    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(true);
  });

  it('bounds attachments and releases capacity independently', () => {
    const registry = new ActiveTurnRegistry();
    const first = handle('first');
    const second = handle('second');
    registry.register('turn', first, 1);
    expect(() => registry.register('turn', second, 1)).toThrow(TurnAttachmentLimitReached);
    registry.release('turn', first);
    expect(registry.register('turn', second, 1).aborted).toBe(false);
  });
});

function handle(value: string): AdmissionHandle {
  return Object.freeze({ admissionId: value } as AdmissionHandle);
}
