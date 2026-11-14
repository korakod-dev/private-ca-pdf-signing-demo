// Loader for the Markdown under src/content/{sign,archive,ops,missions}/ (sub-task G).
//
// The files are bundled at build time (Vite `?raw` glob), so no network request and no runtime file access.
// File layout (checked by `npm run check:content`):
//   line 1     <!-- refs: A, B -->           main-spec codes the text is based on
//   ## <name>  one section per second-level heading, e.g. "อธิบายสั้น" / "รายละเอียดทางเทคนิค"
// Two-layer text: the page shows the simple section by default and the technical section behind "รายละเอียดทางเทคนิค".
const RAW = import.meta.glob('../../content/{sign,archive,ops,missions}/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Section headings used by the content files. */
export const SECTION = {
  simple: 'อธิบายสั้น',
  technical: 'รายละเอียดทางเทคนิค',
  intro: 'แนะนำภารกิจ',
  happened: 'สิ่งที่เพิ่งเกิดขึ้น',
} as const;

export interface ParsedContent {
  /** Main-spec refs from the header comment. */
  refs: string[];
  /** Section body by heading text (the heading line itself is dropped). */
  sections: Record<string, string>;
}

const REFS_HEADER = /^<!--\s*refs:\s*([^>]*?)\s*-->\s*$/;

/** Splits a content file into its refs and its `## ` sections. Pure; exported for tests. */
export function parseContent(markdown: string): ParsedContent {
  const lines = (markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown).split(/\r?\n/);
  const header = REFS_HEADER.exec(lines[0] ?? '');
  const refs = header ? (header[1] ?? '').split(',').map((r) => r.trim()).filter((r) => r !== '') : [];
  const sections: Record<string, string> = {};
  let current: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (current !== null) sections[current] = buffer.join('\n').trim();
  };
  for (const line of lines.slice(header ? 1 : 0)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      current = heading[1] ?? null;
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  flush();
  return { refs, sections };
}

/** Loads `src/content/<dir>/<name>.md`. Returns empty content (never throws) when the file is missing. */
export function loadContent(dir: 'sign' | 'archive' | 'ops' | 'missions', name: string): ParsedContent {
  const raw = RAW[`../../content/${dir}/${name}.md`];
  return raw === undefined ? { refs: [], sections: {} } : parseContent(raw);
}

/** Raw Markdown of `src/content/<dir>/<name>.md` for <LayeredContent markdown=...>; null when the file is missing. */
export function getMarkdown(dir: 'sign' | 'archive' | 'ops' | 'missions', name: string): string | null {
  return RAW[`../../content/${dir}/${name}.md`] ?? null;
}
