import assert from 'node:assert/strict';
import test from 'node:test';

import { copyTextToClipboard } from './src/lib/clipboard.mjs';

test('copyTextToClipboard writes the entire prompt without changing whitespace', async () => {
  const prompt = '첫 번째 줄\n\n  들여쓴 두 번째 줄  \n마지막 줄';
  let copiedText = null;

  await copyTextToClipboard(prompt, {
    async writeText(value) {
      copiedText = value;
    },
  });

  assert.equal(copiedText, prompt);
});

test('copyTextToClipboard rejects when the Clipboard API is unavailable', async () => {
  await assert.rejects(copyTextToClipboard('prompt', null), /CLIPBOARD_UNAVAILABLE/);
});
