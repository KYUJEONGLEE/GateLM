import assert from 'node:assert/strict';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { MarkdownMessage } from './src/components/markdown-message.mjs';

function render(content, citations = []) {
  return renderToStaticMarkup(MarkdownMessage({ content, citations }));
}

test('assistant markdown renders headings, emphasis, lists, code, and GFM tables', () => {
  const html = render(`# 제목

**중요한 내용**과 \`inlineCode\`

- 첫 번째
- 두 번째

\`\`\`ts
const enabled = true;
\`\`\`

| 항목 | 상태 |
| --- | --- |
| Markdown | 지원 |`);

  assert.match(html, /<h1>제목<\/h1>/);
  assert.match(html, /<strong>중요한 내용<\/strong>/);
  assert.match(html, /<code>inlineCode<\/code>/);
  assert.match(html, /<ul>/);
  assert.match(html, /class="language-ts"/);
  assert.match(html, /<table>/);
});

test('assistant markdown blocks raw HTML and unsafe link protocols', () => {
  const html = render(`<script>alert('unsafe')</script>

[안전한 링크](https://example.com)

[위험한 링크](javascript:alert('unsafe'))

![추적 이미지](https://example.com/tracker.png)`);

  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /\[이미지: 추적 이미지\]/);
});

test('assistant markdown renders only verified RAG source markers as citation anchors', () => {
  const html = render('근거가 있습니다[S1]. 위조된 [S999]는 그대로 둡니다.', [{ sourceId: 'S1' }]);

  assert.match(html, /class="message-citation-marker"/);
  assert.match(html, /href="#citation-S1"/);
  assert.match(html, />1<\/a>/);
  assert.match(html, /\[S999\]/);
  assert.doesNotMatch(html, /citation-S999/);
});
