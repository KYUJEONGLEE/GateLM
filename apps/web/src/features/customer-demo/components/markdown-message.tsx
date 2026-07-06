import type { ReactNode } from "react";

type MarkdownBlock =
  | { content: string; type: "paragraph" }
  | { content: string; level: 1 | 2 | 3; type: "heading" }
  | { content: string; language: string | null; type: "code" }
  | { content: string; type: "math" }
  | { items: string[]; type: "ordered-list" | "unordered-list" }
  | { content: string; type: "quote" };

type MarkdownMessageProps = {
  content: string;
};

const unorderedListPattern = /^\s*[-*+]\s+(.+)$/;
const orderedListPattern = /^\s*\d+[.)]\s+(.+)$/;

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="customer-chat-markdown">
      {parseMarkdownBlocks(content).map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      index += 1;
      continue;
    }

    if (trimmedLine.startsWith("```")) {
      const language = trimmedLine.slice(3).trim() || null;
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({ content: codeLines.join("\n"), language, type: "code" });
      continue;
    }

    if (trimmedLine.startsWith("$$")) {
      const { content: mathContent, nextIndex } = readDelimitedMathBlock(lines, index, "$$", "$$");
      blocks.push({ content: mathContent, type: "math" });
      index = nextIndex;
      continue;
    }

    if (trimmedLine.startsWith("\\[")) {
      const { content: mathContent, nextIndex } = readDelimitedMathBlock(lines, index, "\\[", "\\]");
      blocks.push({ content: mathContent, type: "math" });
      index = nextIndex;
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmedLine);
    if (headingMatch) {
      blocks.push({
        content: headingMatch[2] ?? "",
        level: headingMatch[1]?.length as 1 | 2 | 3,
        type: "heading"
      });
      index += 1;
      continue;
    }

    const unorderedListMatch = unorderedListPattern.exec(line);
    if (unorderedListMatch) {
      const items: string[] = [];
      while (index < lines.length) {
        const itemMatch = unorderedListPattern.exec(lines[index] ?? "");
        if (!itemMatch) {
          break;
        }
        items.push(itemMatch[1] ?? "");
        index += 1;
      }
      blocks.push({ items, type: "unordered-list" });
      continue;
    }

    const orderedListMatch = orderedListPattern.exec(line);
    if (orderedListMatch) {
      const items: string[] = [];
      while (index < lines.length) {
        const itemMatch = orderedListPattern.exec(lines[index] ?? "");
        if (!itemMatch) {
          break;
        }
        items.push(itemMatch[1] ?? "");
        index += 1;
      }
      blocks.push({ items, type: "ordered-list" });
      continue;
    }

    if (trimmedLine.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const quoteLine = lines[index] ?? "";
        if (!quoteLine.trim().startsWith(">")) {
          break;
        }
        quoteLines.push(quoteLine.replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ content: quoteLines.join("\n"), type: "quote" });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && !isBlockBoundary(lines[index] ?? "")) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push({ content: paragraphLines.join("\n"), type: "paragraph" });
  }

  return blocks.length > 0 ? blocks : [{ content, type: "paragraph" }];
}

function isBlockBoundary(line: string) {
  const trimmedLine = line.trim();
  return (
    !trimmedLine ||
    trimmedLine.startsWith("```") ||
    trimmedLine.startsWith("$$") ||
    trimmedLine.startsWith("\\[") ||
    /^#{1,3}\s+/.test(trimmedLine) ||
    unorderedListPattern.test(line) ||
    orderedListPattern.test(line) ||
    trimmedLine.startsWith(">")
  );
}

function renderBlock(block: MarkdownBlock, index: number) {
  switch (block.type) {
    case "heading":
      return renderHeading(block.level, block.content, index);
    case "code":
      return (
        <pre key={index}>
          {block.language ? <span>{block.language}</span> : null}
          <code>{block.content}</code>
        </pre>
      );
    case "math":
      return (
        <div className="customer-chat-math-block" key={index}>
          {renderMathExpression(block.content, `math-block-${index}`)}
        </div>
      );
    case "unordered-list":
      return (
        <ul key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={`${index}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
    case "ordered-list":
      return (
        <ol key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={`${index}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
    case "quote":
      return <blockquote key={index}>{renderInlineMarkdown(block.content)}</blockquote>;
    case "paragraph":
    default:
      return <p key={index}>{renderInlineMarkdown(block.content)}</p>;
  }
}

function renderHeading(level: 1 | 2 | 3, content: string, index: number) {
  const children = renderInlineMarkdown(content);

  if (level === 1) {
    return <h2 key={index}>{children}</h2>;
  }

  if (level === 2) {
    return <h3 key={index}>{children}</h3>;
  }

  return <h4 key={index}>{children}</h4>;
}

function renderInlineMarkdown(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const inlinePattern = /(`[^`]+`|\\\([^)]+\\\)|\$[^$\n]+\$|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|\n)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(value)) !== null) {
    if (match.index > cursor) {
      nodes.push(value.slice(cursor, match.index));
    }

    const token = match[0];
    const key = nodes.length;

    if (token === "\n") {
      nodes.push(<br key={key} />);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("\\(")) {
      nodes.push(
        <span className="customer-chat-math-inline" key={key}>
          {renderMathExpression(token.slice(2, -2), `math-inline-${key}`)}
        </span>
      );
    } else if (token.startsWith("$")) {
      nodes.push(
        <span className="customer-chat-math-inline" key={key}>
          {renderMathExpression(token.slice(1, -1), `math-inline-${key}`)}
        </span>
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(renderLinkToken(token, key));
    }

    cursor = match.index + token.length;
  }

  if (cursor < value.length) {
    nodes.push(value.slice(cursor));
  }

  return nodes;
}

function readDelimitedMathBlock(lines: string[], startIndex: number, startToken: string, endToken: string) {
  const firstLine = (lines[startIndex] ?? "").trim();
  const firstContent = firstLine.slice(startToken.length);
  const mathLines: string[] = [];

  if (firstContent.trim().endsWith(endToken)) {
    return {
      content: firstContent.trim().slice(0, -endToken.length).trim(),
      nextIndex: startIndex + 1
    };
  }

  if (firstContent.trim()) {
    mathLines.push(firstContent);
  }

  let index = startIndex + 1;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmedLine = line.trim();

    if (trimmedLine.endsWith(endToken)) {
      mathLines.push(line.replace(new RegExp(`${escapeRegExp(endToken)}\\s*$`), ""));
      index += 1;
      break;
    }

    mathLines.push(line);
    index += 1;
  }

  return {
    content: mathLines.join("\n").trim(),
    nextIndex: index
  };
}

function renderMathExpression(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let textBuffer = "";

  function flushText() {
    if (!textBuffer) {
      return;
    }
    nodes.push(<span key={`${keyPrefix}-text-${nodes.length}`}>{replaceMathCommands(textBuffer)}</span>);
    textBuffer = "";
  }

  while (cursor < value.length) {
    if (value.startsWith("\\frac", cursor)) {
      const numerator = readMathArgument(value, cursor + 5);
      const denominator = readMathArgument(value, numerator.endIndex);

      if (numerator.content && denominator.content) {
        flushText();
        nodes.push(
          <span className="customer-chat-math-frac" key={`${keyPrefix}-frac-${nodes.length}`}>
            <span>{renderMathExpression(numerator.content, `${keyPrefix}-frac-n-${nodes.length}`)}</span>
            <span>{renderMathExpression(denominator.content, `${keyPrefix}-frac-d-${nodes.length}`)}</span>
          </span>
        );
        cursor = denominator.endIndex;
        continue;
      }
    }

    if (value.startsWith("\\sqrt", cursor)) {
      const argument = readMathArgument(value, cursor + 5);

      if (argument.content) {
        flushText();
        nodes.push(
          <span className="customer-chat-math-root" key={`${keyPrefix}-sqrt-${nodes.length}`}>
            <span>√</span>
            <span>{renderMathExpression(argument.content, `${keyPrefix}-sqrt-a-${nodes.length}`)}</span>
          </span>
        );
        cursor = argument.endIndex;
        continue;
      }
    }

    if (value[cursor] === "^" || value[cursor] === "_") {
      const isSuperscript = value[cursor] === "^";
      const argument = readMathArgument(value, cursor + 1);

      if (argument.content) {
        flushText();
        const ScriptTag = isSuperscript ? "sup" : "sub";
        nodes.push(
          <ScriptTag key={`${keyPrefix}-script-${nodes.length}`}>
            {renderMathExpression(argument.content, `${keyPrefix}-script-a-${nodes.length}`)}
          </ScriptTag>
        );
        cursor = argument.endIndex;
        continue;
      }
    }

    textBuffer += value[cursor] ?? "";
    cursor += 1;
  }

  flushText();
  return nodes.length > 0 ? nodes : [value];
}

function readMathArgument(value: string, startIndex: number) {
  let cursor = startIndex;

  while (value[cursor] === " ") {
    cursor += 1;
  }

  if (value[cursor] !== "{") {
    return {
      content: value[cursor] ?? "",
      endIndex: cursor + 1
    };
  }

  let depth = 0;
  let endIndex = cursor;

  while (endIndex < value.length) {
    const character = value[endIndex];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    }
    endIndex += 1;
  }

  return {
    content: value.slice(cursor + 1, endIndex),
    endIndex: endIndex + 1
  };
}

function replaceMathCommands(value: string) {
  return value
    .replaceAll("\\alpha", "α")
    .replaceAll("\\beta", "β")
    .replaceAll("\\gamma", "γ")
    .replaceAll("\\delta", "δ")
    .replaceAll("\\epsilon", "ε")
    .replaceAll("\\theta", "θ")
    .replaceAll("\\lambda", "λ")
    .replaceAll("\\mu", "μ")
    .replaceAll("\\pi", "π")
    .replaceAll("\\sigma", "σ")
    .replaceAll("\\omega", "ω")
    .replaceAll("\\Delta", "Δ")
    .replaceAll("\\Omega", "Ω")
    .replaceAll("\\times", "×")
    .replaceAll("\\cdot", "·")
    .replaceAll("\\leq", "≤")
    .replaceAll("\\geq", "≥")
    .replaceAll("\\neq", "≠")
    .replaceAll("\\approx", "≈")
    .replaceAll("\\infty", "∞")
    .replaceAll("\\sum", "∑")
    .replaceAll("\\int", "∫")
    .replaceAll("\\rightarrow", "→")
    .replaceAll("\\leftarrow", "←")
    .replaceAll("\\to", "→");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderLinkToken(token: string, key: number) {
  const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);

  if (!linkMatch) {
    return token;
  }

  const [, label, href] = linkMatch;
  const safeHref = sanitizeHref(href ?? "");

  if (!safeHref) {
    return label;
  }

  return (
    <a href={safeHref} key={key} rel="noreferrer" target="_blank">
      {label}
    </a>
  );
}

function sanitizeHref(value: string) {
  const trimmedValue = value.trim();

  if (/^(https?:|mailto:)/i.test(trimmedValue)) {
    return trimmedValue;
  }

  return null;
}
