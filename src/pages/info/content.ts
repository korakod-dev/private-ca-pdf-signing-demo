// Loader for the explanation Markdown under src/content/** that sub-task E owns (results, verify, guide, pki, about, policy).
//
// File convention (checked by `npm run check:content`):
//   <!-- refs: V5, V6 -->            first line: main-spec reference ids (at least one)
//   simple Thai text ...            the default layer, always visible
//   ## รายละเอียดทางเทคนิค           optional marker line
//   technical text ...              second layer, collapsed by default (see Explain)
// Parsing lives in src/lib/layers.ts; rendering in src/components/LayeredContent.tsx (shared by every page group, F29).
//
// The files are bundled at build time (eager glob), so no extra request is needed and the CSP stays unchanged.
// Only E's folders are globbed: other clusters' content stays out of this bundle.

const RAW = import.meta.glob<string>(
  [
    '../../content/results/**/*.md',
    '../../content/verify/**/*.md',
    '../../content/guide/**/*.md',
    '../../content/pki/**/*.md',
    '../../content/about/**/*.md',
    '../../content/policy/**/*.md',
  ],
  { query: '?raw', import: 'default', eager: true },
);

/** "../../content/results/X.md" -> "results/X" (the key pages ask for). */
function toKey(globPath: string): string {
  return globPath.replace(/^.*\/content\//, '').replace(/\.md$/, '');
}

const FILES: ReadonlyMap<string, string> = new Map(Object.entries(RAW).map(([path, text]) => [toKey(path), text]));

import { splitLayers, type ContentLayers } from '../../lib/layers';

// Re-exported for the tests and for callers that need the parsed layers.
export { splitLayers, type ContentLayers };

/** Content for a key such as "results/MODIFIED_CONTENT"; null when there is no such file. */
export function getContent(key: string): ContentLayers | null {
  const text = FILES.get(key);
  return text === undefined ? null : splitLayers(text);
}

/** Raw Markdown for a key (what <LayeredContent markdown=...> takes); null when there is no such file. */
export function getMarkdown(key: string): string | null {
  return FILES.get(key) ?? null;
}

/** All keys (tests use this to check coverage). */
export function contentKeys(): string[] {
  return [...FILES.keys()].sort();
}
