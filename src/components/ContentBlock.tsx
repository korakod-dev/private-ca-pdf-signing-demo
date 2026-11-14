// Renders repo-authored markdown (src/content/**) with react-markdown.
// No raw HTML: `skipHtml` drops HTML nodes (including the leading <!-- refs: ... --> comment) and no rehype-raw is used.
// Heading levels are shifted down by one (# -> h2) because the page itself owns the single h1.
import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Link } from 'react-router';

/** Heading renderer: explicit children (not a props spread) so the heading always has accessible content. */
const heading = (Tag: 'h2' | 'h3' | 'h4' | 'h5' | 'h6', cls: string) =>
  function Heading({ children }: { children?: ReactNode }) {
    return <Tag className={cls}>{children}</Tag>;
  };

const COMPONENTS: Components = {
  h1: heading('h2', 'mt-4 text-xl font-bold'),
  h2: heading('h3', 'mt-3 text-lg font-semibold'),
  h3: heading('h4', 'mt-2 font-semibold'),
  h4: heading('h5', 'mt-2 font-semibold'),
  h5: heading('h6', 'mt-2 font-semibold'),
  h6: heading('h6', 'mt-2 font-semibold'),
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-6">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 text-sm">{children}</code>,
  // tabIndex: a horizontally scrollable code block must be reachable by keyboard (axe: scrollable-region-focusable).
  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded bg-slate-100 p-3 text-sm" tabIndex={0}>{children}</pre>,
  a: ({ href, children }) =>
    href?.startsWith('/') ? (
      <Link className="text-blue-800 underline" to={href}>
        {children}
      </Link>
    ) : (
      // Content may not contain external URLs (check-content); anything else renders as plain text.
      <span>{children}</span>
    ),
};

export function ContentBlock({ markdown, testId }: { markdown: string; testId?: string }) {
  return (
    <div data-testid={testId} className="text-slate-800">
      <ReactMarkdown skipHtml components={COMPONENTS}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
