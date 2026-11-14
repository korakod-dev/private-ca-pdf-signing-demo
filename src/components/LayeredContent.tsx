// The ONE two-layer explanation renderer (QA F29; it replaces three page-group copies). One Markdown file in, three parts out:
// the simple Thai text (always visible), the main-spec reference ids from the file header (ALWAYS visible, so every page that
// explains something says which spec item it rests on) and the technical layer in the collapsed <details> of <Explain>.
// The refs header line itself is dropped by ContentBlock (skipHtml). A missing file renders a neutral Thai fallback.
import { splitLayers } from '../lib/layers';
import { ContentBlock } from './ContentBlock';
import { Explain } from './Explain';

export interface LayeredContentProps {
  /** Raw Markdown of a content file (refs header + layers); null/undefined when the file does not exist. */
  markdown: string | null | undefined;
  testId?: string;
}

export function LayeredContent({ markdown, testId }: LayeredContentProps) {
  if (markdown === null || markdown === undefined) {
    return (
      <p data-testid={testId} className="text-slate-700">
        ยังไม่มีคำอธิบายสำหรับหัวข้อนี้
      </p>
    );
  }
  const { simple, technical, refs } = splitLayers(markdown);
  return (
    <div data-testid={testId}>
      <Explain technical={technical ? <ContentBlock markdown={technical} /> : undefined}>
        <ContentBlock markdown={simple} />
      </Explain>
      {refs.length > 0 ? (
        <p data-testid="content-refs" className="mt-2 text-xs text-slate-700">
          อ้างอิงรหัสข้อใน spec หลัก: <span className="font-mono">{refs.join(', ')}</span>
        </p>
      ) : null}
    </div>
  );
}
