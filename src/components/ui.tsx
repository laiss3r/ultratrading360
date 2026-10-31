'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

export function Button({ children, variant = 'primary', busy = false, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; busy?: boolean }) {
  return <button type="button" {...props} disabled={props.disabled || busy} className={`button button-${variant} ${className}`} aria-busy={busy}>{busy && <LoaderCircle size={16} className="spin" />}{children}</button>;
}
export function Panel({ children, title, subtitle, action, className = '' }: { children: ReactNode; title?: string; subtitle?: string; action?: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{(title || action) && <header className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>}<div className="panel-content">{children}</div></section>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'error' | 'success' }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><span className="empty-mark">—</span><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}
export function Metric({ label, value, detail, positive = false }: { label: string; value: ReactNode; detail?: string; positive?: boolean }) {
  return <div className="metric"><span>{label}</span><strong className={positive ? 'positive' : ''}>{value}</strong>{detail && <small>{detail}</small>}</div>;
}
export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" className="toggle-row" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span>{label}</span><span className="switch-track"><i /></span></button>;
}
export function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}
