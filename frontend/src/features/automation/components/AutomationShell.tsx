import {
  Bell,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Command,
  CreditCard,
  Code2,
  FileSearch,
  Github,
  Cable,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  Send,
  Workflow,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useLogout } from '@/features/auth/hooks/useAuth';

const navigation = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/automations', label: 'Command center', icon: Workflow },
  { to: '/automations?view=approvals', label: 'Approval inbox', icon: Bell },
  { to: '/github/agent', label: 'GitHub agent', icon: Code2 },
  { to: '/social', label: 'Social publishing', icon: Send },
  { to: '/integrations', label: 'Integrations', icon: Cable },
  { to: '/reviews', label: 'Code reviews', icon: FileSearch },
  { to: '/github/repos', label: 'Repositories', icon: Github },
];

const quickLinks = [
  ...navigation,
  { to: '/billing', label: 'Billing', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: Settings },
];

interface AutomationShellProps {
  title: string;
  description: string;
  userName: string;
  pendingApprovals: number;
  children: React.ReactNode;
}

export const AutomationShell = ({
  title,
  description,
  userName,
  pendingApprovals,
  children,
}: AutomationShellProps): JSX.Element => {
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const matchingLinks = quickLinks.filter((item) =>
    item.label.toLowerCase().includes(search.trim().toLowerCase())
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const openQuickLink = (to: string): void => {
    const [pathname, query] = to.split('?');
    navigate({ pathname, search: query ? `?${query}` : '' });
    setSearch('');
    setSearchOpen(false);
  };

  const signOut = async (): Promise<void> => {
    try {
      await logout.mutateAsync();
      navigate('/login', { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to sign out. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-[#080b12] text-slate-100">
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-white/[0.07] bg-[#0b0e15] transition-[width] duration-200 lg:flex ${
          collapsed ? 'w-[76px]' : 'w-[248px]'
        }`}
      >
        <div className="flex h-[72px] items-center justify-between border-b border-white/[0.07] px-4">
          <Link to="/dashboard" className="flex min-w-0 items-center gap-3" aria-label="AI CodeGuard home">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-lg shadow-indigo-500/20">
              <Workflow className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            {!collapsed && (
              <span className="truncate text-[14px] font-semibold tracking-tight text-white">
                AI CodeGuard
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="rounded-md p-1.5 text-slate-500 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-5" aria-label="Main navigation">
          {!collapsed && (
            <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
              Workspace
            </p>
          )}
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={({ isActive }) => {
                const active =
                  to === '/automations'
                    ? isActive && !location.search.includes('view=approvals')
                    : to.includes('?view=approvals')
                      ? isActive && location.search.includes('view=approvals')
                      : isActive;
                return (
                  `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                    active
                      ? 'bg-indigo-500/[0.13] text-indigo-200'
                      : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                  } ${collapsed ? 'justify-center px-0' : ''}`
                );
              }}
              end={to === '/dashboard'}
            >
              <Icon className="h-[17px] w-[17px] shrink-0" aria-hidden="true" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}

          {!collapsed && (
            <p className="mb-3 mt-8 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
              Account
            </p>
          )}
          {[
            { to: '/billing', label: 'Billing', icon: CreditCard },
            { to: '/settings', label: 'Settings', icon: Settings },
          ].map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                  isActive
                    ? 'bg-indigo-500/[0.13] text-indigo-200'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                } ${collapsed ? 'justify-center px-0' : ''}`
              }
            >
              <Icon className="h-[17px] w-[17px] shrink-0" aria-hidden="true" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/[0.07] p-3">
          <div className={`flex items-center gap-3 rounded-lg p-2 ${collapsed ? 'justify-center' : ''}`}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-slate-300">
              <CircleUserRound className="h-4 w-4" aria-hidden="true" />
            </span>
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-300">
                  {userName}
                </span>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  disabled={logout.isPending}
                  aria-label="Sign out"
                  title="Sign out"
                  className="rounded-md p-1.5 text-slate-500 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      <div className={collapsed ? 'lg:pl-[76px]' : 'lg:pl-[248px]'}>
        <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-[#080b12]/90 backdrop-blur-xl">
          <div className="flex h-[72px] items-center gap-4 px-4 sm:px-6 lg:px-9">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                to="/dashboard"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500 text-white lg:hidden"
                aria-label="AI CodeGuard home"
              >
                <Workflow className="h-4 w-4" aria-hidden="true" />
              </Link>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold text-white">{title}</h1>
                <p className="hidden truncate text-xs text-slate-500 sm:block">{description}</p>
              </div>
            </div>
            <div
              className="relative mx-auto hidden w-full max-w-[360px] flex-1 md:block"
              onBlur={(event) => {
                const nextTarget = event.relatedTarget;
                if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                  setSearchOpen(false);
                }
              }}
            >
              <label className="relative block">
                <span className="sr-only">Search available pages</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  ref={searchInput}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onFocus={() => setSearchOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setSearchOpen(false);
                    if (event.key === 'Enter' && matchingLinks[0]) {
                      event.preventDefault();
                      openQuickLink(matchingLinks[0].to);
                    }
                  }}
                  placeholder="Search pages..."
                  aria-expanded={searchOpen}
                  className="h-9 w-full rounded-lg border border-white/[0.08] bg-white/[0.025] pl-9 pr-10 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-indigo-400/40 focus:bg-white/[0.04]"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded border border-white/[0.08] px-1.5 py-0.5 text-[9px] text-slate-600">
                  <Command className="h-3 w-3" aria-hidden="true" /> K
                </span>
              </label>
              {searchOpen && (
                <div
                  id="quick-search-results"
                  className="absolute left-0 right-0 top-11 z-40 overflow-hidden rounded-xl border border-white/[0.09] bg-[#10141e] p-1.5 shadow-2xl shadow-black/40"
                >
                  <p className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                    {search ? 'Matching pages' : 'Quick navigation'}
                  </p>
                  {matchingLinks.length === 0 ? (
                    <p className="px-2.5 py-3 text-xs text-slate-500">No matching pages.</p>
                  ) : (
                    matchingLinks.map(({ to, label, icon: Icon }) => (
                      <button
                        key={to}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => openQuickLink(to)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs text-slate-300 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      >
                        <Icon className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                        <span className="flex-1">{label}</span>
                        {location.pathname === to.split('?')[0] && (
                          <span className="text-[9px] text-indigo-300">Current</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Link
                to="/automations?view=approvals"
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] text-slate-400 transition hover:border-white/15 hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                aria-label={
                  pendingApprovals > 0
                    ? `Approval inbox, ${pendingApprovals} pending`
                    : 'Approval inbox'
                }
                title="Approval inbox"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                {pendingApprovals > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-2 border-[#080b12] bg-amber-400 px-1 text-[9px] font-bold text-slate-950">
                    {pendingApprovals > 9 ? '9+' : pendingApprovals}
                  </span>
                )}
              </Link>
              <Link
                to="/settings"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.03] text-xs font-semibold text-slate-300 transition hover:border-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                aria-label={`Account settings for ${userName}`}
              >
                {userName.trim().charAt(0).toUpperCase() || 'U'}
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={logout.isPending}
                aria-label="Sign out"
                title="Sign out"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] text-slate-400 transition hover:bg-white/[0.04] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-50 lg:hidden"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-white/[0.05] px-3 py-2 lg:hidden" aria-label="Mobile navigation">
            {[
              ...navigation,
              { to: '/billing', label: 'Billing', icon: CreditCard },
              { to: '/settings', label: 'Settings', icon: Settings },
            ].map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/dashboard'}
                className={({ isActive }) => {
                  const active =
                    to === '/automations'
                      ? isActive && !location.search.includes('view=approvals')
                      : to.includes('?view=approvals')
                        ? isActive && location.search.includes('view=approvals')
                        : isActive;
                  return (
                    `flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs font-medium ${
                      active ? 'bg-indigo-500/[0.13] text-indigo-200' : 'text-slate-400'
                    }`
                  );
                }}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
        </header>
        <main
          className="mx-auto w-full max-w-[1320px] px-4 py-7 sm:px-6 sm:py-9 lg:px-9"
          onClick={() => setSearchOpen(false)}
        >
          {children}
        </main>
      </div>
    </div>
  );
};
