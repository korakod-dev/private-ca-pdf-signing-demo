// Pure parser for the two-layer content files (src/content/**/*.md), shared by every page group.
//
// File convention (checked by `npm run check:content`):
//   <!-- refs: V5, R15 -->          first line: main-spec reference ids (at least one)
//   [## อธิบายสั้น]                 optional heading of the simple layer (the ops files have it; it is dropped)
//   simple Thai text ...            the default layer, always visible
//   ## รายละเอียดทางเทคนิค           optional marker line (heading level 1-4 accepted)
//   technical text ...              second layer, collapsed by default (see <Explain>)

export interface ContentLayers {
  /** Default layer (Markdown, refs header removed). */
  simple: string;
  /** Technical layer (Markdown) or null when the file has none. */
  technical: string | null;
  /** Main-spec reference ids from the header. */
  refs: string[];
}

const REFS_LINE = /^<!--\s*refs:\s*([^>]*?)\s*-->\s*$/;
const TECHNICAL_MARKER = /^#{1,4}\s*รายละเอียดทางเทคนิค\s*$/m;
const SIMPLE_HEADING = /^##\s+อธิบายสั้น\s*\n?/;

/** Splits one Markdown document into its layers and refs. Pure; never throws. */
export function splitLayers(markdown: string): ContentLayers {
  const text = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown; // drop a byte-order mark
  const lines = text.split(/\r?\n/);
  const header = REFS_LINE.exec(lines[0] ?? '');
  const refs = header ? (header[1] ?? '').split(',').map((r) => r.trim()).filter((r) => r.length > 0) : [];
  const body = (header ? lines.slice(1) : lines).join('\n');
  const marker = TECHNICAL_MARKER.exec(body);
  const simpleRaw = (marker ? body.slice(0, marker.index) : body).trim();
  const simple = simpleRaw.replace(SIMPLE_HEADING, '').trim();
  if (!marker) return { simple, technical: null, refs };
  const technical = body.slice(marker.index + marker[0].length).trim();
  return { simple, technical: technical.length > 0 ? technical : null, refs };
}
