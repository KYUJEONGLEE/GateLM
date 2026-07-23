export const SCROLL_FOLLOW_THRESHOLD_PX = 48;

export function distanceFromScrollBottom(
  { scrollHeight, clientHeight, scrollTop },
  threshold = SCROLL_FOLLOW_THRESHOLD_PX,
) {
  const distance = scrollHeight - clientHeight - scrollTop;
  return Math.max(0, distance) <= threshold;
}

export function reduceScrollFollow(following, event) {
  switch (event.type) {
    case 'conversation-change':
    case 'initial-load':
    case 'jump-to-latest':
    case 'message-send':
      return true;
    case 'scroll':
      return distanceFromScrollBottom(event.metrics, event.threshold);
    case 'scroll-up-intent':
      return false;
    case 'stream-delta':
      return following;
    default:
      return following;
  }
}
