import type { AdmissionHandle } from '@/execution/execution.types';

import { RetentionService } from './retention.service';

describe('RetentionService', () => {
  it('uses the delete primitive and cancels active handles after commit', async () => {
    const handle = Object.freeze({ admissionId: 'safe-id' } as AdmissionHandle);
    const store = {
      deleteExpiredBatch: jest.fn().mockResolvedValue({ deleted: 2, cancelledTurnIds: ['turn-1'] }),
    };
    const activeTurns = { abort: jest.fn().mockReturnValue([handle]) };
    const bridge = { cancel: jest.fn().mockResolvedValue({ state: 'cancelled' }) };
    const config = {
      getOrThrow: (name: string) => name === 'TENANT_CHAT_RETENTION_BATCH_SIZE' ? 25 : 60_000,
    };
    const service = new RetentionService(
      config as never,
      store as never,
      activeTurns as never,
      bridge as never,
    );

    await expect(service.runOnce()).resolves.toBe(2);
    expect(store.deleteExpiredBatch).toHaveBeenCalledWith(25);
    expect(activeTurns.abort).toHaveBeenCalledWith('turn-1');
    expect(bridge.cancel).toHaveBeenCalledWith(handle);
  });
});
