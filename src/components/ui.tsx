'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ Card */

export function Card({
  children,
  className,
  title,
  subtitle,
  right,
  pad = true,
}: {
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  pad?: boolean;
}) {
  return (
    <section className={cn('card flex flex-col overflow-hidden', className)}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-semibold tracking-wide text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11px] leading-snug text-ink-3">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', pad && 'p-4')}>{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------- Button */

type Variant = 'primary' | 'ghost' | 'outline' | 'danger' | 'success' | 'subtle';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-[#1a1400] hover:bg-[#ffc933] font-semibold',
  success: 'bg-profit text-[#04241a] hover:bg-[#1ade95] font-semibold',
  danger: 'bg-loss text-white hover:bg-[#ff5560] font-semibold',
  outline: 'border border-line-strong text-ink hover:bg-hover',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
  subtle: 'bg-elevated text-ink-2 hover:bg-hover hover:text-ink',
};

export function Button({
  children,
  onClick,
  variant = 'outline',
  size = 'md',
  disabled,
  className,
  title,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg transition-colors duration-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        size === 'sm' && 'px-2.5 py-1 text-[11px]',
        size === 'md' && 'px-3.5 py-1.5 text-xs',
        size === 'lg' && 'px-5 py-2.5 text-sm',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        VARIANT[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- Badge */

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'profit' | 'loss' | 'warn' | 'info' | 'brand';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-elevated text-ink-2 border-line-strong',
    profit: 'bg-profit-dim text-profit border-profit/30',
    loss: 'bg-loss-dim text-loss border-loss/30',
    warn: 'bg-warn-dim text-warn border-warn/30',
    info: 'bg-info/12 text-info border-info/30',
    brand: 'bg-brand/12 text-brand border-brand/30',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Stat */

export function Stat({
  label,
  value,
  tone,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'profit' | 'loss' | 'warn' | 'muted';
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg border border-line bg-base/40 px-3 py-2.5', className)}>
      <div className="text-[10px] font-medium tracking-wider text-ink-3 uppercase">{label}</div>
      <div
        className={cn(
          'num mt-1 text-[17px] leading-tight font-semibold text-ink',
          tone === 'profit' && 'text-profit',
          tone === 'loss' && 'text-loss',
          tone === 'warn' && 'text-warn',
          tone === 'muted' && 'text-ink-2',
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[10px] leading-snug text-ink-4">{hint}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- Field */

export function Field({
  label,
  children,
  hint,
  error,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-[11px] font-medium tracking-wide text-ink-2">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] text-loss">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] leading-snug text-ink-4">{hint}</span>
      ) : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  tone = 'brand',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  tone?: 'brand' | 'danger';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border border-line bg-base/40 p-3 text-left transition-colors',
        !disabled && 'hover:border-line-strong',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'mt-0.5 inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full border transition-colors',
          checked
            ? tone === 'danger'
              ? 'border-loss/50 bg-loss/30'
              : 'border-brand/50 bg-brand/25'
            : 'border-line-strong bg-elevated',
        )}
      >
        <span
          className={cn(
            'mx-[2px] h-[12px] w-[12px] rounded-full transition-transform',
            checked ? (tone === 'danger' ? 'translate-x-[14px] bg-loss' : 'translate-x-[14px] bg-brand') : 'bg-ink-4',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{hint}</span>}
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; tone?: 'profit' | 'loss' | 'warn' }[];
  className?: string;
}) {
  return (
    <div className={cn('inline-flex rounded-lg border border-line bg-base/60 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
            value === o.value
              ? o.tone === 'loss'
                ? 'bg-loss/18 text-loss'
                : o.tone === 'profit'
                  ? 'bg-profit/18 text-profit'
                  : o.tone === 'warn'
                    ? 'bg-warn/18 text-warn'
                    : 'bg-elevated text-ink'
              : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Empty/Load */

export function Empty({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
      <div className="text-xs font-medium text-ink-3">{title}</div>
      {children && <div className="max-w-md text-[11px] leading-relaxed text-ink-4">{children}</div>}
    </div>
  );
}

export function Banner({
  tone,
  children,
  className,
}: {
  tone: 'info' | 'warn' | 'danger' | 'success';
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-info/30 bg-info/8 text-ink-2',
    warn: 'border-warn/30 bg-warn/8 text-warn',
    danger: 'border-loss/30 bg-loss/8 text-loss',
    success: 'border-profit/30 bg-profit/8 text-profit',
  };
  return (
    <div className={cn('rounded-lg border px-3 py-2 text-[11px] leading-relaxed', tones[tone], className)}>
      {children}
    </div>
  );
}

export function NavLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn('text-xs text-accent hover:underline', className)}>
      {children}
    </Link>
  );
}
