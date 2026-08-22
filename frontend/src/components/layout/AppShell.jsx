import React, { useState, useEffect } from 'react';
import { Github, X, Shield, BarChart2 } from 'lucide-react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

export default function AppShell({
  activeTab,
  setActiveTab,
  onShowAuth,
  onOpenPrivacyModal,
  children,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer on Escape key
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && mobileOpen) {
        setMobileOpen(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-[#0b0713] text-[#f5f3ff] flex font-body selection:bg-purple-500 selection:text-white">
      {/* Desktop Sidebar (Fixed ≥1024px) */}
      <div className="hidden lg:block w-60 shrink-0 h-screen sticky top-0 z-40">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onShowAuth={onShowAuth}
        />
      </div>

      {/* Mobile Drawer Backdrop + Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="w-72 max-w-[85vw] h-full bg-[#140e24] shadow-2xl relative flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-xl text-[#a1a1c2] hover:text-white hover:bg-white/10"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
            <Sidebar
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onShowAuth={onShowAuth}
              onCloseMobile={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          onOpenMobile={() => setMobileOpen(true)}
          onShowAuth={onShowAuth}
          activeTab={activeTab}
        />

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          <div key={activeTab} className="tab-content-enter">
            {children}
          </div>
        </main>

        {/* Consumer Footer */}
        <footer className="border-t border-white/5 bg-[#0b0713] py-6 px-4 sm:px-6 lg:px-8 text-xs text-[#6b6b8f] mt-auto">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 flex-wrap justify-center text-center sm:text-left">
              <span className="font-bold text-white font-heading">MusicLens</span>
              <span>•</span>
              <span>Discover the sound of your music</span>
              <span>•</span>
              <span>© {new Date().getFullYear()}</span>
            </div>

            <div className="flex items-center gap-4 text-[#a1a1c2]">
              <button
                type="button"
                onClick={onOpenPrivacyModal}
                className="hover:text-purple-300 transition-colors flex items-center gap-1"
              >
                <Shield className="w-3.5 h-3.5" /> Privacy
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('powerbi')}
                className="hover:text-purple-300 transition-colors flex items-center gap-1"
              >
                <BarChart2 className="w-3.5 h-3.5" /> Data & BI spec
              </button>

              <a
                href="https://github.com/inddivyansh/MusicLens"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-purple-300 transition-colors flex items-center gap-1"
              >
                <Github className="w-3.5 h-3.5" /> GitHub
              </a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
