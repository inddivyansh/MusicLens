import React, { useState } from 'react';
import { 
  BarChart3, 
  Sparkles, 
  Radio, 
  LayoutDashboard, 
  Music2,
  LogIn,
  LogOut,
  Loader2,
  User,
  UserCircle2,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import SpotifyPanel from './SpotifyPanel';

export default function Navbar({ activeTab, setActiveTab, onShowAuth }) {
  const navItems = [
    { id: 'overview',    label: '1. Music Overview',        icon: LayoutDashboard, badge: 'KPIs'       },
    { id: 'audio',       label: '2. Audio Analytics',       icon: BarChart3,       badge: 'ANOVA'      },
    { id: 'recommender', label: '3. Recommender',           icon: Sparkles,        badge: 'AI'         },
    { id: 'mymusic',     label: '4. My Music',              icon: UserCircle2,     badge: 'Profile'    },
    { id: 'recap',       label: '5. Recap',                 icon: Music2,          badge: 'Summary'    },
    { id: 'blend',       label: '6. Blend',                 icon: Users,           badge: 'Friend'     },
    { id: 'powerbi',     label: '7. Power BI Spec',         icon: Radio,           badge: 'Enterprise' },
  ];

  const { user, loading: authLoading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    setLoggingOut(false);
  }

  return (
    <header className="sticky top-0 z-50 glass-panel border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl px-4 lg:px-8 py-3 mb-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        
        {/* Brand Logo & Tagline */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white font-bold">
            <Music2 className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold tracking-tight text-white font-heading">
                Music<span className="text-blue-400">Lens</span>
              </span>
              <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full">
                Analytics Platform
              </span>
            </div>
            <p className="text-xs text-slate-400">
              30k Spotify Songs • Precomputed analytics • Explainable recommender
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-200 ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25 border border-blue-400/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.label}</span>
                {item.badge && (
                  <span className={`text-[9px] px-1.5 py-0.2 rounded-md ${
                    isActive ? 'bg-blue-700 text-blue-100' : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Database / Live Status Badge */}
        <div className="hidden xl:flex items-center gap-2 text-xs text-slate-400 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>Static JSON exports</span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-300 font-mono text-[11px]">28,352-track warehouse</span>
        </div>

        {/* ── Auth slot — additive, does not alter tab navigation ── */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {authLoading ? (
            <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
          ) : user ? (
            <>
              {/* Spotify connect/disconnect */}
              <SpotifyPanel />

              {/* User email + logout */}
              <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400">
                  <User className="w-3.5 h-3.5 text-slate-500" />
                  <span className="max-w-[140px] truncate" title={user.email}>{user.email}</span>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent hover:border-slate-700 transition-colors disabled:opacity-50"
                  aria-label="Sign out"
                >
                  {loggingOut
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <LogOut className="w-3.5 h-3.5" />
                  }
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={onShowAuth}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white transition-colors shadow-md shadow-blue-500/20"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign in
            </button>
          )}
        </div>

      </div>
    </header>
  );
}
