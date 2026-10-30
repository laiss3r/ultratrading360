'use client';

import Link from 'next/link';
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ *
 * UI primitives in the Deriv idiom.
 *
 * Deriv's platforms are flat and hairline-bordered rather than shadowed:
 * white surfaces, #d6dadb rules, 4px radii, coral as the single accent
 * for the primary action and the active tab, and teal/red reserved
 * exclusively for profit and loss. Everything here follows that.
 * ------------------------------------------------------------------ */

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
    <section className={cn('dt-card flex flex-col overflow-hidden', className)}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-prominent">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs leading-snug text-less-prominent">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', pad && 'p-4')}>{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------- Button */

type Variant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'outline' | 'danger' | 'success' | 'subtle';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-coral text-white font-bold hover:bg-coral-hover',
  secondary: 'border border-line bg-main-1 text-prominent hover:bg-state-hover',
  tertiary: 'text-coral hover:bg-coral-wash font-bold',
  success: 'bg-profit text-white font-bold hover:opacity-90',
  danger: 'bg-loss text-white font-bold hover:opacity-90',
  outline: 'border border-line bg-main-1 text-prominent hover:bg-state-hover',
  ghost: 'text-general hover:bg-state-hover hover:text-prominent',
  subtle: 'bg-section-1 text-general hover:bg-state-hover hover:text-prominent',
};

/**
 * Native `<button>` attributes are accepted and forwarded.
 *
 * This matters more than it looks. TypeScript does NOT type-check JSX attributes that contain a
 * hyphen, because they cannot be valid identifiers — so `aria-label="Stop bot"` on a component
 * whose props are a closed literal type compiles cleanly, passes lint, and is then silently thrown
 * away at runtime. An icon-only control loses its accessible name and nothing anywhere complains.
 * Extending ButtonHTMLAttributes makes those props real and forwards them to the DOM.
 */
type ButtonProps = {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'>;

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  className,
  title,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded transition-colors duration-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral',
        size === 'sm' && 'px-2.5 py-1 text-xs',
        size === 'md' && 'px-4 py-1.5 text-xs',
        size === 'lg' && 'px-6 py-2.5 text-sm',
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
    neutral: 'bg-section-1 text-less-prominent border-line',
    profit: 'bg-profit-wash text-profit border-profit',
    loss: 'bg-loss-wash text-loss border-loss',
    warn: 'bg-orange-wash text-orange border-orange',
    info: 'bg-blue-wash text-blue border-blue',
    brand: 'bg-coral-wash text-coral border-coral',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xxs font-bold tracking-wide uppercase',
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
    <div className={cn('dt-stat', className)}>
      <div className="dt-stat__title">{label}</div>
      <div
        className={cn(
          'num dt-stat__value',
          tone === 'profit' && 'text-profit',
          tone === 'loss' && 'text-loss',
          tone === 'warn' && 'text-orange',
          tone === 'muted' && 'text-general',
        )}
      >
        {value}
      </div>
      {hint && <div className="text-xxs leading-snug text-less-prominent">{hint}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- Field */

export function Field({
  label,
  children,
  hint,
  error,
  right,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** Optional control on the label row — Deriv puts helper links here. */
  right?: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="flex items-center justify-between gap-2">
        <span className="dt-label mb-0">{label}</span>
        {right}
      </span>
      <span className="mt-1 block">{children}</span>
      {error ? (
        <span className="mt-1 block text-xs text-loss">{error}</span>
      ) : hint ? (
        <span className="dt-hint">{hint}</span>
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
  const on = tone === 'danger' ? 'bg-loss' : 'bg-coral';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-start gap-3 rounded border border-line bg-main-1 p-3 text-left transition-colors',
        !disabled && 'hover:bg-state-hover',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'mt-0.5 inline-flex h-[18px] w-[32px] shrink-0 items-center rounded-full transition-colors',
          checked ? on : 'bg-disabled',
        )}
      >
        <span
          className={cn(
            'mx-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform',
            checked && 'translate-x-[14px]',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-bold text-prominent">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-less-prominent">{hint}</span>}
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
    <div className={cn('inline-flex rounded border border-line bg-section-1 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-sm px-2.5 py-1 text-xs font-bold transition-colors',
            value === o.value
              ? o.tone === 'loss'
                ? 'bg-loss-wash text-loss'
                : o.tone === 'profit'
                  ? 'bg-profit-wash text-profit'
                  : o.tone === 'warn'
                    ? 'bg-orange-wash text-orange'
                    : 'bg-main-1 text-prominent shadow-sm'
              : 'text-less-prominent hover:text-general',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- Tabs (in-panel) */

/**
 * Panel tabs, matching the Summary / Transactions / Journal strip at the top
 * of Deriv Bot's run drawer. Distinct from the header navigation tabs, which
 * are routes rather than local state.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div className={cn('dt-panel-tabs', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          data-active={value === o.value}
          onClick={() => onChange(o.value)}
          className="dt-panel-tab"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- Money */

/**
 * Amounts with an explicit sign and the currency shown, as Deriv's own
 * `<Money>` does. Profit and loss are coloured by the status tokens only —
 * never by proximity to zero, so a flat result stays neutral.
 */
export function Money({
  amount,
  currency,
  showCurrency = false,
  hasSign = false,
  className,
}: {
  amount: number;
  currency?: string;
  showCurrency?: boolean;
  hasSign?: boolean;
  className?: string;
}) {
  const sign = hasSign && amount > 0 ? '+' : '';
  const tone = amount > 0 ? 'text-profit' : amount < 0 ? 'text-loss' : 'text-prominent';
  return (
    <span className={cn('num', tone, className)}>
      {sign}
      {amount.toFixed(2)}
      {showCurrency && currency ? ` ${currency}` : ''}
    </span>
  );
}

/* ------------------------------------------------------------ Empty/Load */

export function Empty({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
      <div className="text-xs font-bold text-less-prominent">{title}</div>
      {children && <div className="max-w-md text-xs leading-relaxed text-less-prominent">{children}</div>}
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
    info: 'border-blue bg-blue-wash text-general',
    warn: 'border-orange bg-orange-wash text-general',
    danger: 'border-loss bg-loss-wash text-general',
    success: 'border-profit bg-profit-wash text-general',
  };
  return (
    <div className={cn('rounded border px-3 py-2 text-xs leading-relaxed', tones[tone], className)}>{children}</div>
  );
}

export function NavLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn('text-xs text-coral hover:underline', className)}>
      {children}
    </Link>
  );
}

/* ----------------------------------------------------------------- Modal */

/**
 * Deriv modals are narrow, titled, and dismissible with Escape. The overlay
 * click and the key handler are both wired because a modal that can only be
 * closed by finding its button traps keyboard users.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[8vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(e) => e.stopPropagation()}
        className="dt-card w-full shadow-lg"
        style={{ maxWidth: width }}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-bold text-prominent">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded p-1 text-less-prominent hover:bg-state-hover hover:text-prominent"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="max-h-[64vh] overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- ContractCard */

/**
 * The per-trade result card Deriv Bot shows in the Summary tab: a coloured
 * disc carrying the contract-type glyph, the market and outcome, and the
 * stake/payout pair on the right.
 */
export function ContractCard({
  icon,
  title,
  subtitle,
  stake,
  payout,
  result,
  currency,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  stake?: number;
  payout?: number;
  result?: 'win' | 'loss' | 'pending';
  currency?: string;
  className?: string;
}) {
  const net = stake != null && payout != null ? payout - stake : undefined;
  return (
    <div
      className={cn(
        'dt-contract',
        result === 'win' && 'dt-contract--win',
        result === 'loss' && 'dt-contract--loss',
        className,
      )}
    >
      <div
        className="dt-contract__icon"
        style={{ background: result === 'win' ? 'var(--color-profit)' : result === 'loss' ? 'var(--color-loss)' : 'var(--color-brand2)' }}
      >
        {icon ?? <span className="text-xs font-bold">?</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold text-prominent">{title}</div>
        {subtitle && <div className="truncate text-xxs text-less-prominent">{subtitle}</div>}
      </div>
      <div className="shrink-0 text-right">
        {stake != null && <div className="num text-xxs text-less-prominent">Stake {stake.toFixed(2)}</div>}
        {payout != null && (
          <div className={cn('num text-xs font-bold', (net ?? 0) >= 0 ? 'text-profit' : 'text-loss')}>
            {payout.toFixed(2)} {currency ?? ''}
          </div>
        )}
      </div>
    </div>
  );
}
