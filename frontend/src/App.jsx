import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import OverviewTab from './components/OverviewTab';
import AudioAnalyticsTab from './components/AudioAnalyticsTab';
import RecommenderTab from './components/RecommenderTab';
import PowerBiTab from './components/PowerBiTab';
import ProfileTab from './components/ProfileTab';
import RecapTab from './components/RecapTab';
import BlendTab from './components/BlendTab';
import AuthForm from './components/AuthForm';
import { AlertCircle, RefreshCw, Github, X } from 'lucide-react';
import { applyDatasetStats } from './utils/recommenderClient';
import { AuthProvider, useAuth } from './context/AuthContext';
import { analyticsApi } from './utils/apiClient';

// (fetchJson removed — analytics loads via analyticsApi with static JSON fallback in AppInner)

// ── Auth form slide-in overlay ────────────────────────────────────────────
function AuthFormOverlay({ onClose }) {
  const { user } = useAuth();

  // Auto-close when login/register succeeds
  useEffect(() => {
    if (user) onClose();
  }, [user, onClose]);

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-16 px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md">
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition-colors"
          aria-label="Close sign-in form"
        >
          <X className="w-4 h-4" />
        </button>
        <AuthForm />
      </div>
    </div>
  );
}

// ── Inner app (has access to AuthContext) ─────────────────────────────────
function AppInner() {
  const [activeTab, setActiveTab] = useState('overview');
  const [dashboardData, setDashboardData] = useState(null);
  const [analyticsSource, setAnalyticsSource] = useState(null); // 'api' | 'static' | null
  const [searchCatalog, setSearchCatalog] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [spotifyBanner, setSpotifyBanner] = useState(false);
  const [blendInviteToken, setBlendInviteToken] = useState(null);

  const { refreshSpotifyStatus } = useAuth();

  // ── URL param handling (Spotify callback + blend invite) ────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('spotify') === 'connected') {
      window.history.replaceState({}, '', window.location.pathname);
      setSpotifyBanner(true);
      refreshSpotifyStatus();
      const t = setTimeout(() => setSpotifyBanner(false), 5000);
      return () => clearTimeout(t);
    }
    // Blend invite token from URL
    const blendToken = params.get('blend');
    if (blendToken && /^[a-f0-9]{64}$/i.test(blendToken)) {
      window.history.replaceState({}, '', window.location.pathname);
      setBlendInviteToken(blendToken);
      setActiveTab('blend');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Analytics load: try dynamic API first, fall back to static JSON ──
  useEffect(() => {
    async function loadData() {
      try {
        setDataLoading(true);
        setDataError(null);

        // Always load the search catalog (needed by legacy recommender seed picker)
        // This is a small file (~2500 tracks) and still used for the manual seed path.
        let search = [];
        try {
          const searchRes = await fetch('/analytics/search_index.json');
          if (searchRes.ok) {
            const raw = await searchRes.text();
            search = JSON.parse(raw);
          }
        } catch {
          // search_index.json missing — legacy recommender won't work but app continues
        }
        if (Array.isArray(search) && search.length > 0) {
          setSearchCatalog(search);
        }

        // Try dynamic API first
        try {
          const [overviewData, artistData] = await Promise.all([
            analyticsApi.overview(),
            analyticsApi.artists(50),
          ]);

          if (!overviewData?.kpis) throw new Error('API response missing kpis');

          // Merge into the bundle shape OverviewTab/AudioAnalyticsTab expect
          const bundle = {
            kpis:            overviewData.kpis,
            genres:          overviewData.genres          || [],
            decade_evolution: overviewData.decade_evolution || [],
            top_artists:     artistData?.top_artists       || [],
            // Carry through these fields if available from static JSON
            feature_ranges:  null,
            mood_distribution: null,
            feature_distributions: null,
          };

          // Best-effort: also try to load remaining fields from static JSON
          // (audio feature distributions, ANOVA data) for AudioAnalyticsTab
          try {
            const staticRes = await fetch('/analytics/dashboard_bundle.json');
            if (staticRes.ok) {
              const staticBundle = await staticRes.json();
              bundle.feature_ranges       = staticBundle.feature_ranges       || null;
              bundle.mood_distribution    = staticBundle.mood_distribution    || null;
              bundle.feature_distributions = staticBundle.feature_distributions || null;
              bundle.anova_results        = staticBundle.anova_results        || null;
              // Don't override fresh API data for kpis/genres/artists
            }
          } catch {
            // Static JSON unavailable — AudioAnalyticsTab will show its empty state
          }

          if (bundle.feature_ranges) applyDatasetStats(bundle.feature_ranges);

          setDashboardData(bundle);
          setAnalyticsSource('api');
          return;
        } catch (apiErr) {
          // API unavailable (DB not connected, cold start) — fall through to static JSON
          console.warn('[App] Dynamic analytics API unavailable, trying static JSON:', apiErr.message);
        }

        // Fallback: load static JSON (works on initial deploy before DB is live)
        const staticRes = await fetch('/analytics/dashboard_bundle.json');
        if (!staticRes.ok) {
          throw new Error(`Could not load analytics (HTTP ${staticRes.status}). Run the pipeline or check DATABASE_URL.`);
        }
        const bundle = await staticRes.json();
        if (!bundle?.kpis) {
          throw new Error('dashboard_bundle.json is missing expected KPI fields.');
        }
        if (bundle.feature_ranges) applyDatasetStats(bundle.feature_ranges);
        setDashboardData(bundle);
        setAnalyticsSource('static');

      } catch (err) {
        setDataError(err instanceof Error ? err.message : 'Error loading analytics.');
      } finally {
        setDataLoading(false);
      }
    }
    loadData();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-body">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onShowAuth={() => setShowAuthForm(true)}
        analyticsSource={analyticsSource}
      />

      {/* Auth overlay */}
      {showAuthForm && <AuthFormOverlay onClose={() => setShowAuthForm(false)} />}

      {/* Spotify connected success banner */}
      {spotifyBanner && (
        <div className="mx-auto mt-4 max-w-md px-4 w-full">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-900/40 border border-emerald-500/30 rounded-lg text-sm text-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
            Spotify connected successfully!
            <button
              type="button"
              onClick={() => setSpotifyBanner(false)}
              className="ml-auto text-emerald-400 hover:text-emerald-200"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 pb-12">
        {dataLoading ? (
          <div className="glass-panel p-16 text-center space-y-4 my-12">
            <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto" />
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-white">Loading MusicLens Analytics</h2>
              <p className="text-xs text-slate-400 font-mono">
                Connecting to the PostgreSQL warehouse…
              </p>
            </div>
          </div>
        ) : dataError ? (
          <div className="glass-panel p-12 text-center space-y-4 my-12 border-red-500/30 bg-red-950/20">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-white">Analytics could not be loaded</h2>
              <p className="text-xs text-slate-400">{dataError}</p>
              <p className="text-xs text-slate-500 font-mono">
                Check DATABASE_URL configuration or run the Python pipeline to generate static exports.
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold rounded-lg text-slate-200 inline-flex items-center gap-2 border border-slate-700"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        ) : (
          <div>
            {activeTab === 'overview'    && <OverviewTab data={dashboardData} />}
            {activeTab === 'audio'       && <AudioAnalyticsTab data={dashboardData} />}
            {activeTab === 'recommender' && <RecommenderTab searchCatalog={searchCatalog} />}
            {activeTab === 'mymusic'     && <ProfileTab onShowAuth={() => setShowAuthForm(true)} />}
            {activeTab === 'recap'       && <RecapTab onShowAuth={() => setShowAuthForm(true)} />}
            {activeTab === 'blend'       && <BlendTab onShowAuth={() => setShowAuthForm(true)} initialInviteToken={blendInviteToken} />}
            {activeTab === 'powerbi'     && <PowerBiTab />}
          </div>
        )}
      </main>

      <footer className="glass-panel border-t border-slate-800/80 bg-slate-950/80 mt-auto py-6 px-4 lg:px-8 text-xs text-slate-400">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <span className="font-bold text-slate-200">MusicLens</span>
            <span>•</span>
            <span>Spotify 30,000 Songs</span>
            <span>•</span>
            <span className="text-emerald-400">Dynamic Platform on Vercel</span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span className="font-mono text-[11px]">React + Vite • PostgreSQL analytics • Serverless API</span>
            <span className="text-slate-600">|</span>
            <a
              href="https://github.com/inddivyansh/MusicLens"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-blue-400 flex items-center gap-1 transition-colors"
            >
              <Github className="w-3.5 h-3.5" /> GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Root export — wraps everything in AuthProvider ───────────────────────
export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
