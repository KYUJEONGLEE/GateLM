import assert from 'node:assert/strict';
import test from 'node:test';

import {
  distanceFromScrollBottom,
  reduceScrollFollow,
  SCROLL_FOLLOW_THRESHOLD_PX,
} from './src/lib/scroll-follow.mjs';

test('하단 48px 안에서는 스트리밍 출력을 계속 추적한다', () => {
  assert.equal(SCROLL_FOLLOW_THRESHOLD_PX, 48);
  assert.equal(distanceFromScrollBottom({ scrollHeight: 1_000, clientHeight: 400, scrollTop: 552 }), true);
  assert.equal(reduceScrollFollow(true, { type: 'stream-delta' }), true);
});

test('사용자가 위로 스크롤하려는 즉시 자동 추적을 중단한다', () => {
  assert.equal(reduceScrollFollow(true, { type: 'scroll-up-intent' }), false);
  assert.equal(reduceScrollFollow(false, { type: 'stream-delta' }), false);
});

test('사용자가 하단으로 돌아오면 자동 추적을 재개한다', () => {
  assert.equal(reduceScrollFollow(false, {
    type: 'scroll',
    metrics: { scrollHeight: 1_000, clientHeight: 400, scrollTop: 560 },
  }), true);
});

test('최신 답변 버튼은 자동 추적을 재개한다', () => {
  assert.equal(reduceScrollFollow(false, { type: 'jump-to-latest' }), true);
});

test('대화 전환과 최초 로드 및 메시지 전송은 자동 추적을 재개한다', () => {
  assert.equal(reduceScrollFollow(false, { type: 'conversation-change' }), true);
  assert.equal(reduceScrollFollow(false, { type: 'initial-load' }), true);
  assert.equal(reduceScrollFollow(false, { type: 'message-send' }), true);
});
