import { Injectable } from '@nestjs/common';

import type { AdmissionHandle } from '@/execution/execution.types';

export class TurnAttachmentLimitReached extends Error {}

export type TurnAttachmentReservation = Readonly<{ token: symbol }>;

@Injectable()
export class ActiveTurnRegistry {
  private readonly active = new Map<string, {
    controller: AbortController;
    attachments: Map<symbol, AdmissionHandle | undefined>;
  }>();

  reserve(turnId: string, maximum: number): TurnAttachmentReservation {
    const entry = this.active.get(turnId) ?? {
      controller: new AbortController(),
      attachments: new Map<symbol, AdmissionHandle | undefined>(),
    };
    if (entry.attachments.size >= maximum) throw new TurnAttachmentLimitReached();
    const token = Symbol(turnId);
    entry.attachments.set(token, undefined);
    this.active.set(turnId, entry);
    return Object.freeze({ token });
  }

  activate(
    turnId: string,
    reservation: TurnAttachmentReservation,
    handle: AdmissionHandle,
  ): AbortSignal {
    const entry = this.active.get(turnId);
    if (!entry?.attachments.has(reservation.token)) throw new TurnAttachmentLimitReached();
    entry.attachments.set(reservation.token, handle);
    return entry.controller.signal;
  }

  register(turnId: string, handle: AdmissionHandle, maximum: number): AbortSignal {
    const reservation = this.reserve(turnId, maximum);
    try {
      return this.activate(turnId, reservation, handle);
    } catch (error) {
      this.releaseReservation(turnId, reservation);
      throw error;
    }
  }

  abort(turnId: string): readonly AdmissionHandle[] {
    const entry = this.active.get(turnId);
    if (!entry) return Object.freeze([]);
    entry.controller.abort();
    return Object.freeze(
      [...entry.attachments.values()].filter(
        (handle): handle is AdmissionHandle => handle !== undefined,
      ),
    );
  }

  releaseReservation(turnId: string, reservation: TurnAttachmentReservation): boolean {
    const entry = this.active.get(turnId);
    if (!entry) return true;
    entry.attachments.delete(reservation.token);
    const empty = entry.attachments.size === 0;
    if (empty) this.active.delete(turnId);
    return empty;
  }

  release(turnId: string, handle: AdmissionHandle): void {
    const entry = this.active.get(turnId);
    if (!entry) return;
    for (const [token, attached] of entry.attachments) {
      if (attached === handle) {
        entry.attachments.delete(token);
        break;
      }
    }
    if (entry.attachments.size === 0) this.active.delete(turnId);
  }
}
