export type ClipboardWriter = Readonly<{
  writeText(text: string): Promise<void>;
}>;

export function copyTextToClipboard(text: string, clipboard?: ClipboardWriter): Promise<void>;
