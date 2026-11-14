// "Download" button for demo artifacts (spec section 5): the demo never hands out anything that looks like a real
// certificate, .p12 or signed PDF. Whatever the caller names the file, the download is a plain .txt whose first line
// is the DEMO watermark text.
import type { ReactNode } from 'react';
import { DEMO_WATERMARK_TEXT } from '../config/demo';
import { Button } from './Button';

const DEMO_PREFIX = 'DEMO-';

/**
 * Forces a safe demo file name: no path parts, no control characters, the real extension (if any) replaced by ".txt",
 * and a "DEMO-" prefix. Examples: "cert.crt" -> "DEMO-cert.txt", "memo-130-s2.signed.pdf" -> "DEMO-memo-130-s2.signed.txt".
 */
export function toDemoFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f<>:"|?*]/g, '').trim();
  const stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'file';
  const prefixed = stem.startsWith(DEMO_PREFIX) ? stem : `${DEMO_PREFIX}${stem}`;
  return `${prefixed}.txt`;
}

/** Content always starts with the watermark line, even when the caller forgot it. */
export function toDemoFileContent(body: string): string {
  return body.startsWith(DEMO_WATERMARK_TEXT) ? body : `${DEMO_WATERMARK_TEXT}\n\n${body}`;
}

export interface DownloadDemoFileProps {
  /** Suggested name; the extension is replaced by .txt (see toDemoFileName). */
  fileName: string;
  /** Explanatory text describing what the real file would be. */
  content: string;
  children?: ReactNode;
  testId?: string;
  disabled?: boolean;
}

export function DownloadDemoFile({ fileName, content, children, testId, disabled }: DownloadDemoFileProps) {
  const safeName = toDemoFileName(fileName);

  const download = () => {
    const blob = new Blob([toDemoFileContent(content)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="secondary" onClick={download} data-testid={testId} data-file-name={safeName} disabled={disabled}>
      {children ?? `ดาวน์โหลด ${safeName}`}
    </Button>
  );
}
