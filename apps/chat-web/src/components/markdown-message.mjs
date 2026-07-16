import { createElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const markdownComponents = {
  a({ children, ...properties }) {
    return createElement('a', {
      ...properties,
      rel: 'noopener noreferrer',
      target: '_blank',
    }, children);
  },
  img({ alt }) {
    return alt
      ? createElement('span', { className: 'message-markdown-image-alt' }, `[이미지: ${alt}]`)
      : null;
  },
};

export function MarkdownMessage({ content }) {
  return createElement(
    'div',
    { className: 'message-markdown' },
    createElement(Markdown, {
      components: markdownComponents,
      remarkPlugins: [remarkGfm],
      skipHtml: true,
    }, content),
  );
}
