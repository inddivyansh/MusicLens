import React, { useState, useEffect } from 'react';
import AppShell from './components/layout/AppShell';
import OverviewTab from './components/OverviewTab';
import AudioAnalyticsTab from './components/AudioAnalyticsTab';
import RecommenderTab from './components/RecommenderTab';
import PowerBiTab from './components/PowerBiTab';
import ProfileTab from './components/ProfileTab';
import RecapTab from './components/RecapTab';
import BlendTab from './components/BlendTab';
import AuthForm from './components/AuthForm';
import PrivacyPolicyModal from './components/PrivacyPolicyModal';
import LoadingState from './components/ui/LoadingState';
import ErrorState from './components/ui/ErrorState';
import { X, CheckCircle2 } from 'lucide-react';
import { applyDatasetStats } from './utils/recommenderClient';
import { AuthProvider, useAuth } from './context/AuthContext';
import { analyticsApi } from './utils/apiClient';

// ── Auth form slide-in modal overlay ──────────────────────────────────────────
function AuthFormOverlay({ onClose }) {
  const { user } = useAuth();

  useEffect(() => {
    if (user) onClose();
  }, [user, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md">
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-[#1e1533] border border-white/10 text-[#a1a1c2] hover:text-white transition-colors"
          aria-label="Close sign-in form"
        >
          <X className="w-4 h-4" />
        </button>
        <AuthForm />
      </div>
    </div>
  );
}

// ── Inner app (accesses AuthContext) ─────────────────────────────────────────
function AppInner() {
  const [activeTab, setActiveTab] = useState('overview');
  const [dashboardData, setDashboardData] = useState(null);
  const [searchCatalog, setSearchCatalog] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
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

    const blendToken = params.get('blend');
    if (blendToken && /^[a-f0-9]{64}$/i.test(blendToken)) {
      window.history.replaceState({}, '', window.location.pathname);
      setBlendInviteToken(blendToken);
      setActiveTab('blend');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Analytics load: dynamic API first, fallback to static JSON ──────
  async function loadData() {
    try {
      setDataLoading(true);
      setDataError(null);

      // Search catalog for manual seed path
      let search = [];
      try {
        const searchRes = await fetch('/analytics/search_index.json');
        if (searchRes.ok) {
          const raw = await searchRes.text();
          search = JSON.parse(raw);
        }
      } catch (err) {
        console.warn('[App] Search index not available:', err);
      }
      if (Array.isArray(search) && search.length > 0) {
        setSearchCatalog(search);
      }

      // Try dynamic API
      try {
        const [overviewData, artistData] = await Promise.all([
          analyticsApi.overview(),
          analyticsApi.artists(50),
        ]);

        if (!overviewData?.kpis) throw new Error('API response missing kpis');

        const bundle = {
          kpis: overviewData.kpis,
          genres: overviewData.genres || [],
          decade_evolution: overviewData.decade_evolution || [],
          top_artists: artistData?.top_artists || [],
          feature_ranges: null,
          mood_distribution: null,
          feature_distributions: null,
        };

        try {
          const staticRes = await fetch('/analytics/dashboard_bundle.json');
          if (staticRes.ok) {
            const staticBundle = await staticRes.json();
            bundle.feature_ranges = staticBundle.feature_ranges || null;
            bundle.mood_distribution = staticBundle.mood_distribution || null;
            bundle.feature_distributions = staticBundle.feature_distributions || null;
            bundle.anova_results = staticBundle.anova_results || null;
          }
        } catch {
          // Static file optional
        }

        if (bundle.feature_ranges) applyDatasetStats(bundle.feature_ranges);
        setDashboardData(bundle);
        return;
      } catch (apiErr) {
        console.warn('[App] Analytics API unavailable, attempting static file fallback:', apiErr);
      }

      // Fallback: static JSON
      const staticRes = await fetch('/analytics/dashboard_bundle.json');
      if (!staticRes.ok) {
        throw new Error(`Could not load analytics file (status ${staticRes.status}).`);
      }
      const bundle = await staticRes.json();
      if (!bundle?.kpis) {
        throw new Error('Analytics file missing expected KPI fields.');
      }
      if (bundle.feature_ranges) applyDatasetStats(bundle.feature_ranges);
      setDashboardData(bundle);

    } catch (err) {
      console.error('[App] Failed to load catalog analytics:', err);
      setDataError('We could not load the music catalog insights at this moment.');
    } finally {
      setDataLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  return (
    <AppShell
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onShowAuth={() => setShowAuthForm(true)}
      onOpenPrivacyModal={() => setShowPrivacyModal(true)}
    >
      {/* Auth Modal Overlay */}
      {showAuthForm && <AuthFormOverlay onClose={() => setShowAuthForm(false)} />}

      {/* Privacy Policy Modal */}
      {showPrivacyModal && <PrivacyPolicyModal onClose={() => setShowPrivacyModal(false)} />}

      {/* Spotify Connected Success Toast */}
      {spotifyBanner && (
        <div className="fixed top-20 right-6 z-50 animate-bounce">
          <div className="flex items-center gap-2.5 px-4 py-3 bg-[#140e24] border border-emerald-500/40 rounded-2xl text-xs font-semibold text-emerald-300 shadow-2xl shadow-emerald-950/50">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Spotify connected successfully!</span>
            <button
              type="button"
              onClick={() => setSpotifyBanner(false)}
              className="ml-2 text-emerald-400 hover:text-emerald-200"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Tab Render Slot */}
      {dataLoading ? (
        <LoadingState message="Loading catalog music insights…" />
      ) : dataError ? (
        <ErrorState
          title="Catalog insights unavailable"
          message="We couldn't load the music catalog right now. Please try again."
          onRetry={loadData}
        />
      ) : (
        <>
          {activeTab === 'overview' && <OverviewTab data={dashboardData} />}
          {activeTab === 'audio' && <AudioAnalyticsTab data={dashboardData} />}
          {activeTab === 'recommender' && <RecommenderTab searchCatalog={searchCatalog} />}
          {activeTab === 'mymusic' && <ProfileTab onShowAuth={() => setShowAuthForm(true)} />}
          {activeTab === 'recap' && <RecapTab onShowAuth={() => setShowAuthForm(true)} />}
          {activeTab === 'blend' && (
            <BlendTab
              onShowAuth={() => setShowAuthForm(true)}
              initialInviteToken={blendInviteToken}
            />
          )}
          {activeTab === 'powerbi' && <PowerBiTab />}
        </>
      )}
    </AppShell>
  );
}

// ── Root Export ─────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
