import React from 'react';
import { Menu, Sparkles, LogIn } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import SpotifyPanel from '../SpotifyPanel';
import Avatar from '../ui/Avatar';

export default function Topbar({ onOpenMobile, onShowAuth }) {
  const { user, loading: authLoading } = useAuth();

  return (
    <header className="sticky top-0 z-30 h-16 w-full bg-[#0b0713]/85 backdrop-blur-xl border-b border-white/5 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
      {/* Mobile Hamburger & Brand */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobile}
          className="lg:hidden p-2 rounded-xl text-[#a1a1c2] hover:text-white hover:bg-[#1e1533] transition-colors"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="lg:hidden flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-signature-gradient p-[1.5px] flex items-center justify-center shrink-0">
            <div className="w-full h-full rounded-full bg-[#0b0713] flex items-center justify-center">
              <div className="w-1 h-1 rounded-full bg-purple-200" />
            </div>
          </div>
          <span className="text-base font-extrabold tracking-tight text-white font-heading">
            Music<span className="text-gradient">Lens</span>
          </span>
        </div>
      </div>

      {/* Right Action Cluster */}
      <div className="flex items-center gap-3 ml-auto">
        {/* Spotify Integration Slot */}
        <SpotifyPanel />

        {/* User state indicator for Topbar */}
        {!authLoading && !user && (
          <button
            type="button"
            onClick={onShowAuth}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-signature-gradient hover:opacity-95 rounded-xl text-xs font-semibold text-white transition-all shadow-md shadow-purple-600/20 active:scale-95"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign in</span>
          </button>
        )}

        {!authLoading && user && (
          <div className="lg:hidden flex items-center">
            <Avatar email={user.email} size="sm" />
          </div>
        )}
      </div>
    </header>
  );
}
