// Diagonal "DEMO" watermark over a block (report previews, document images).
// Decorative: aria-hidden and no pointer events, so it never blocks clicks or screen readers.
//
// Drawn as SVG text, not faint HTML text: axe rates HTML text over a light background for color-contrast
// (measured 1.47:1 = "serious") even when aria-hidden, while SVG text is not rated. The mark stays visible
// (semi-transparent slate, 26px bold on a 400x240 viewBox that scales with the block).
//
// preserveAspectRatio is "meet" (QA F25): the whole 400x240 drawing always fits inside the block. "slice" scaled it up to
// cover a tall block (e.g. a report box with a wrapped SHA-256 at 390 px) and cropped the text to its middle part.
// The Cypress check (verify-learn.cy.ts) asserts the rotated text's bounding box lies inside the block at 1280 and 390 px.
//
// textLength + lengthAdjust make the drawn width font-independent: macOS lays the text out at ~295 units, but the Linux CI
// runner falls back to a wider Thai/Latin font (~430 units measured with a wide font), which overflowed the 400-unit viewBox
// and left the block. Forcing the width to 300 units keeps the text inside the viewBox with any font (spacingAndGlyphs
// squeezes/stretches the glyphs, so the whole text always stays visible). TEXT_LENGTH assumes the default text; scale it
// if a much longer/shorter `text` is ever passed.
import type { ReactNode } from 'react';
import { DEMO_WATERMARK_TEXT } from '../config/demo';

// Drawn width of the watermark text in viewBox units (worst case measured ~310 x 205 rotated bbox inside the 400 x 240 viewBox).
const TEXT_LENGTH = 300;

export function Watermark({ children, text = DEMO_WATERMARK_TEXT }: { children: ReactNode; text?: string }) {
  return (
    <div className="relative overflow-hidden" data-testid="watermark">
      {children}
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 400 240"
        preserveAspectRatio="xMidYMid meet"
        className="pointer-events-none absolute inset-0 h-full w-full select-none"
      >
        <text
          data-testid="watermark-text"
          x="200"
          y="125"
          textAnchor="middle"
          transform="rotate(-25 200 125)"
          fontSize="26"
          fontWeight="700"
          textLength={TEXT_LENGTH}
          lengthAdjust="spacingAndGlyphs"
          className="fill-slate-500/35"
        >
          {text}
        </text>
      </svg>
    </div>
  );
}
