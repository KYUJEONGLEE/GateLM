import { createElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const citationHref = /^#citation-(S[1-9][0-9]{0,2})$/;

const markdownComponents = {
  a({ children, href, ...properties }) {
    const citation = typeof href === 'string' ? citationHref.exec(href) : null;
    if (citation) {
      return createElement(
        'sup',
        { className: 'message-citation-marker' },
        createElement('a', { ...properties, href, 'aria-label': `출처 ${citation[1].slice(1)}` }, children),
      );
    }
    return createElement('a', {
      ...properties,
      href,
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

export function MarkdownMessage({ content = '', citations = [] }) {
  return createElement(
    'div',
    { className: 'message-markdown' },
    createElement(Markdown, {
      components: markdownComponents,
      remarkPlugins: [remarkGfm],
      skipHtml: true,
    }, citationLinks(content, citations)),
  );
}

function citationLinks(content, citations) {
  const numbers = new Map(citations.map((citation, index) => [citation.sourceId, index + 1]));
  return content.replace(/\[S([1-9][0-9]{0,2})\]/g, (marker, number) => {
    const sourceId = `S${number}`;
    const displayNumber = numbers.get(sourceId);
    return displayNumber ? `[${displayNumber}](#citation-${sourceId})` : marker;
  });
}
