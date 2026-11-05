import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getInitials, displayRole } from '../lib/utils';
import NotificationBell from './NotificationBell';
import {
  LayoutDashboard, CalendarCheck, ClipboardList, FileText, CalendarDays,
  LogOut, Menu, History, Users, Building2, UserCog, BarChart3,
  Sun, ScrollText, Settings, FileBadge, Database, FolderOpen, Shield,
} from 'lucide-react';

const Sidebar = ({ mobile = false, nav, pathname, handleMobileClose, user, logout }: { mobile?: boolean; nav: any[]; pathname: string; handleMobileClose: () => void; user: any; logout: () => void }) => (
  <div className={`flex flex-col h-full ${mobile ? 'w-72' : 'w-64'} bg-slate-900 border-r border-slate-800`}>
    <div className="flex items-center gap-3 h-16 px-6 border-b border-slate-800">
      <div className="h-8 w-8 rounded-lg bg-violet-600 flex items-center justify-center font-bold text-white text-sm shadow-lg shadow-violet-600/20">W</div>
      <span className="font-semibold text-lg text-white">WorkTracker</span>
    </div>
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
      {nav.filter((n) => n.show).map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + '/');
        return (
            <Link key={n.name} to={n.href} onClick={mobile ? handleMobileClose : undefined}
            className={`flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition ${active ? 'bg-violet-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            aria-label={n.name}
            aria-current={active ? 'page' : undefined}>
            <n.icon className="h-5 w-5" />{n.name}
          </Link>
        );
      })}
    </nav>
    <div className="border-t border-slate-800 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-9 w-9 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center text-violet-400 text-sm font-bold">
          {getInitials(user?.firstName, user?.lastName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{user?.firstName} {user?.lastName}</p>
          <p className="text-xs text-slate-400">{user?.role ? displayRole(user.role) : ''}</p>
        </div>
      </div>
      <button onClick={logout} className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl text-rose-400 hover:bg-rose-500/10 transition" aria-label="Sign out">
        <LogOut className="h-4 w-4" />Sign Out
      </button>
    </div>
  </div>
);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pageTitle, setPageTitle] = useState('');

  useEffect(() => {
    const label = pathname.split('/').pop() || 'Dashboard';
    setPageTitle(label.charAt(0).toUpperCase() + label.slice(1));
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [mobileOpen]);
  const isAdmin = user?.role === 'director';
  const isHr = user?.role === 'hr';
  const isAdminOrHr = isAdmin || isHr;

  const nav = useMemo(() => [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, show: true },
    { name: 'Attendance', href: '/attendance', icon: CalendarCheck, show: true },
    { name: 'Tasks', href: '/tasks', icon: ClipboardList, show: true },
    { name: 'Work Plans', href: '/plans', icon: FileText, show: true },
    { name: 'Work Progress', href: '/reports', icon: History, show: true },
    { name: 'Leaves', href: '/leaves', icon: CalendarDays, show: true },
    { name: 'Documents', href: '/documents', icon: FileBadge, show: true },
    { name: 'Files', href: '/files', icon: FolderOpen, show: true },
    { name: 'Employee Database', href: '/employee-database', icon: Database, show: isAdminOrHr },
    { name: 'Team', href: '/team', icon: Users, show: isAdminOrHr },
    { name: 'Holidays', href: '/holidays', icon: Sun, show: isAdminOrHr },
    { name: 'Departments', href: '/departments', icon: Building2, show: isAdminOrHr },
    { name: 'Users', href: '/users', icon: UserCog, show: isAdmin },
    { name: 'Analytics', href: '/analytics', icon: BarChart3, show: isAdminOrHr },
    { name: 'Activity Logs', href: '/logs', icon: ScrollText, show: isAdminOrHr },
    { name: 'Security', href: '/security', icon: Shield, show: isAdmin },
    { name: 'Profile', href: '/profile', icon: Settings, show: true },
  ], [isAdminOrHr, isAdmin]);

  const handleMobileClose = useCallback(() => setMobileOpen(false), []);

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden md:flex md:flex-col flex-shrink-0"><Sidebar nav={nav} pathname={pathname} handleMobileClose={handleMobileClose} user={user} logout={logout} /></aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={handleMobileClose} />
          <div className="relative z-10 w-72">
            <Sidebar mobile nav={nav} pathname={pathname} handleMobileClose={handleMobileClose} user={user} logout={logout} />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between h-16 px-4 md:px-6 border-b border-slate-800 bg-slate-900/30 flex-shrink-0 gap-3">
          <div className="flex items-center min-w-0 gap-3">
            <button onClick={() => setMobileOpen(true)} className="md:hidden p-2.5 -ml-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white border border-slate-700" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-lg font-bold text-white capitalize truncate">{pageTitle}</h1>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <NotificationBell />
            <div className="h-8 w-8 rounded-lg bg-violet-600 flex items-center justify-center font-bold text-white text-xs">{getInitials(user?.firstName, user?.lastName)}</div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 safe-bottom">
          <div className="max-w-7xl mx-auto space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
