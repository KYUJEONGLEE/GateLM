export async function copyTextToClipboard(text, clipboard = globalThis.navigator?.clipboard) {
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    throw new Error('CLIPBOARD_UNAVAILABLE');
  }

  await clipboard.writeText(text);
}
