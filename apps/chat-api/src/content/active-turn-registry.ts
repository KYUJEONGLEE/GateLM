import { Injectable } from '@nestjs/common';

import type { AdmissionHandle } from '@/execution/execution.types';

export class TurnAttachmentLimitReached extends Error {}

@Injectable()
export class ActiveTurnRegistry {
  private readonly active = new Map<string, {
    controller: AbortController;
    handles: Set<AdmissionHandle>;
  }>();

  register(turnId: string, handle: AdmissionHandle, maximum: number): AbortSignal {
    const entry = this.active.get(turnId) ?? {
      controller: new AbortController(),
      handles: new Set<AdmissionHandle>(),
    };
    if (entry.handles.size >= maximum) throw new TurnAttachmentLimitReached();
    entry.handles.add(handle);
    this.active.set(turnId, entry);
    return entry.controller.signal;
  }

  abort(turnId: string): readonly AdmissionHandle[] {
    const entry = this.active.get(turnId);
    if (!entry) return Object.freeze([]);
    entry.controller.abort();
    return Object.freeze([...entry.handles]);
  }

  release(turnId: string, handle: AdmissionHandle): void {
    const entry = this.active.get(turnId);
    if (!entry) return;
    entry.handles.delete(handle);
    if (entry.handles.size === 0) this.active.delete(turnId);
  }
}
