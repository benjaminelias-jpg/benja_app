'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const LINKS = [
  { href: '/', label: 'Panel', icon: 'chart' },
  { href: '/inbox', label: 'Bandeja', icon: 'chat' },
  { href: '/contenido', label: 'Contenido', icon: 'play' },
  { href: '/pipeline', label: 'Pipeline', icon: 'columns' },
  { href: '/leads', label: 'Leads', icon: 'users' },
  { href: '/automatizaciones', label: 'Automatizaciones', icon: 'bolt' },
  { href: '/integraciones', label: 'Integraciones', icon: 'plug' },
  { href: '/claude', label: 'Conectá tu Claude', icon: 'spark' },
] as const;

export function Sidebar({ orgName, igUsername }: { orgName: string; igUsername?: string | null }) {
  const pathname = usePathname();

  return (
    <nav
      className="flex h-full w-full flex-col gap-1 border-r border-[var(--border)] bg-surface px-3 py-4"
      aria-label="Navegacion principal"
    >
      <div className="mb-5 flex items-center gap-2.5 px-2">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ background: 'var(--series-1)' }}
          aria-hidden
        >
          H
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">{orgName}</span>
          <span className="block truncate text-[11px] text-muted">
            {igUsername ? `@${igUsername}` : 'Sin cuenta conectada'}
          </span>
        </span>
      </div>

      {LINKS.map((link) => {
        const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
              active
                ? 'bg-surface-2 font-medium text-ink'
                : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
            )}
          >
            <Icon name={link.icon} />
            {link.label}
          </Link>
        );
      })}

      <div className="mt-auto px-2 pt-4">
        <ThemeToggle />
      </div>
    </nav>
  );
}

function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const current =
      root.getAttribute('data-theme') ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try {
      localStorage.setItem('hookcrm-theme', next);
    } catch {
      // Modo privado o almacenamiento bloqueado: el tema vale solo para esta sesion.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-ink-2 hover:bg-surface-2"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
      Cambiar tema
    </button>
  );
}

function Icon({ name }: { name: string }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'chart':
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <path d="M7 15l4-5 3 3 5-7" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 20.5l1.5-4.4A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" />
        </svg>
      );
    case 'play':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M10 9l5 3-5 3V9Z" />
        </svg>
      );
    case 'columns':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="5" height="16" rx="1.5" />
          <rect x="10" y="4" width="5" height="11" rx="1.5" />
          <rect x="17" y="4" width="4" height="7" rx="1.5" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20a6 6 0 0 1 12 0" />
          <path d="M16 11a3 3 0 0 0 0-6" />
          <path d="M18 20a5 5 0 0 0-2-4" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...common}>
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...common}>
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'plug':
      return (
        <svg {...common}>
          <path d="M9 2v6M15 2v6" />
          <path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" />
          <path d="M12 17v5" />
        </svg>
      );
    default:
      return null;
  }
}
