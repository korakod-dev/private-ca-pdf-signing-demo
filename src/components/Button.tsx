// Shared button. Always type="button" unless told otherwise (avoids accidental form submits).
// Colors are picked for WCAG AA contrast (white on blue-800 / red-800, slate-900 on white).
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** "sm" is for dense toolbars such as the demo bar. */
  size?: 'sm' | 'md';
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-blue-800 text-white hover:bg-blue-900 border border-blue-800',
  secondary: 'bg-white text-slate-900 hover:bg-slate-100 border border-slate-500',
  danger: 'bg-red-800 text-white hover:bg-red-900 border border-red-800',
};

const SIZE_CLASS = { sm: 'px-2 py-1 text-xs min-h-8', md: 'px-4 py-2 text-sm min-h-10' } as const;

export function Button({ variant = 'primary', size = 'md', type = 'button', className = '', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`}
      {...rest}
    />
  );
}
