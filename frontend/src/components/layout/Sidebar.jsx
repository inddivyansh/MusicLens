import React from 'react';
import {
  LayoutDashboard,
  BarChart3,
  Sparkles,
  UserCircle2,
  Music2,
  Users,
  LogIn,
  LogOut,
  Loader2,
  User,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import Avatar from '../ui/Avatar';

export default function Sidebar({ activeTab, setActiveTab, onShowAuth, onCloseMobile }) {
  const { user, loading: authLoading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = React.useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await logout();
    setLoggingOut(false);
  }

  const navSections = [
    {
      title: 'Explore',
      items: [
        { id: 'overview', label: 'Overview', icon: LayoutDashboard },
        { id: 'audio', label: 'Audio Analytics', icon: BarChart3 },
        { id: 'recommender', label: 'Recommender', icon: Sparkles },
      ],
    },
    {
      title: 'You',
      items: [
        { id: 'mymusic', label: 'My Music', icon: UserCircle2 },
        { id: 'recap', label: 'Recap', icon: Music2 },
        { id: 'blend', label: 'Blend', icon: Users, badge: 'Beta' },
      ],
    },
  ];

  function handleNav(tabId) {
    setActiveTab(tabId);
    if (onCloseMobile) onCloseMobile();
  }

  return (
    <aside className="flex flex-col h-full bg-[#140e24]/95 border-r border-white/5 p-4 select-none">
      {/* Brand Header */}
      <div className="flex items-center gap-3 px-3 py-4 mb-2">
        <div className="w-9 h-9 rounded-full bg-signature-gradient p-[2px] shadow-lg shadow-purple-900/30 flex items-center justify-center shrink-0">
          <div className="w-full h-full rounded-full bg-[#0b0713] flex items-center justify-center relative overflow-hidden">
            <div className="w-4 h-4 rounded-full border border-purple-400/40" />
            <div className="w-1.5 h-1.5 rounded-full bg-purple-200" />
          </div>
        </div>
        <div>
          <span className="text-lg font-extrabold tracking-tight text-white font-heading">
            Music<span className="text-gradient">Lens</span>
          </span>
          <p className="text-[11px] text-[#6b6b8f] tracking-wide">
            Music Taste & Discovery
          </p>
        </div>
      </div>

      {/* Nav Groups */}
      <nav className="flex-1 space-y-6 px-1 py-2 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.title} className="space-y-1.5">
            <span className="px-3 text-[11px] font-bold uppercase tracking-wider text-[#6b6b8f]">
              {section.title}
            </span>
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNav(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 ${
                      isActive
                        ? 'bg-signature-gradient text-white shadow-md shadow-purple-600/25'
                        : 'text-[#a1a1c2] hover:text-white hover:bg-[#1e1533]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-[#a1a1c2]'}`} />
                      <span>{item.label}</span>
                    </div>
                    {item.badge && (
                      <span
                        className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-purple-500/10 text-purple-300 border border-purple-500/20'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom Pinned User Block */}
      <div className="pt-3 border-t border-white/5 px-1 mt-auto">
        {authLoading ? (
          <div className="flex items-center justify-center p-3 text-[#6b6b8f]">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : user ? (
          <div className="flex items-center justify-between p-2 rounded-xl bg-[#1e1533]/60 border border-white/5">
            <div className="flex items-center gap-2 min-w-0 pr-2">
              <Avatar email={user.email} size="sm" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate max-w-[110px]" title={user.email}>
                  {user.email.split('@')[0]}
                </p>
                <p className="text-[10px] text-[#6b6b8f] truncate max-w-[110px]">
                  {user.email}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="p-1.5 rounded-lg text-[#a1a1c2] hover:text-white hover:bg-white/10 transition-colors shrink-0"
              title="Sign out"
              aria-label="Sign out"
            >
              {loggingOut ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (onCloseMobile) onCloseMobile();
              onShowAuth();
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-signature-gradient hover:opacity-95 text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-purple-600/20 active:scale-95"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign in / Register</span>
          </button>
        )}
      </div>
    </aside>
  );
}
