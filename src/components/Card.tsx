// Simple bordered card. The optional title is a real heading (level chosen by the caller so page outlines stay valid).
import type { ReactNode } from 'react';

export interface CardProps {
  title?: ReactNode;
  /** Heading level of the title (default 2; the page itself owns the h1). */
  headingLevel?: 2 | 3 | 4;
  children?: ReactNode;
  className?: string;
  testId?: string;
}

export function Card({ title, headingLevel = 2, children, className = '', testId }: CardProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section data-testid={testId} className={`rounded-lg border border-slate-300 bg-white p-4 shadow-sm ${className}`}>
      {title ? <Heading className="mb-2 text-lg font-semibold text-slate-900">{title}</Heading> : null}
      {children}
    </section>
  );
}
