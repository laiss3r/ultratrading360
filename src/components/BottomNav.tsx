'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Blocks, Gauge, History, LineChart, Radar } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Phone navigation. Deriv's own mobile apps put the four top-level tabs on a
 * fixed bottom bar instead of a horizontally scrolling strip, because thumbs
 * reach the bottom of a phone and not the top. This is phone-only (hidden at
 * >=768px, where the header tabs take over), every target is at least 44px
 * tall, and it is real navigation — no state, no overlays.
 *
 * Risk manager, Overlord and Connect stay reachable from the dashboard tiles.
 */
const ITEMS = [
  { href: '/', label: 'Home', Icon: Gauge },
  { href: '/builder', label: 'Builder', Icon: Blocks },
  { href: '/chart', label: 'Chart', Icon: LineChart },
  { href: '/signals', label: 'Signals', Icon: Radar },
  { href: '/history', label: 'History', Icon: History },
] as const;

export function BottomNav() {
  const pathname = usePathname() ?? '/';

  return (
    <nav className="dt-bottomnav" aria-label="Phone navigation">
      {ITEMS.map(({ href, label, Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn('dt-bottomnav__item', active && 'is-active')}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={18} strokeWidth={active ? 2.2 : 1.7} aria-hidden />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
