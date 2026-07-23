export const SCROLL_FOLLOW_THRESHOLD_PX: 48;

export type ScrollMetrics = Readonly<{
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}>;

export type ScrollFollowEvent =
  | Readonly<{ type: 'conversation-change' | 'initial-load' | 'jump-to-latest' | 'message-send' | 'scroll-up-intent' | 'stream-delta' }>
  | Readonly<{ type: 'scroll'; metrics: ScrollMetrics; threshold?: number }>;

export function distanceFromScrollBottom(metrics: ScrollMetrics, threshold?: number): boolean;
export function reduceScrollFollow(following: boolean, event: ScrollFollowEvent): boolean;
