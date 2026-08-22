/**
 * frontend/src/components/ProfileTab.jsx
 * "My Music" — Spotify → MusicLens personal profile section.
 *
 * States handled:
 *  - Not logged in          → prompt to sign in
 *  - Logged in, no Spotify  → prompt to connect Spotify
 *  - Spotify connected, no profile yet → prompt to run first analysis
 *  - Profile exists         → show full profile UI
 *  - Refreshing             → loading overlay
 *  - Error                  → error banner with retry
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Music2, RefreshCw, Loader2, AlertCircle, Link2Off,
  Zap, Headphones, BarChart2, User2, CheckCircle2,
  TrendingUp, Mic2, Guitar, Radio, Waves
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { profileApi } from '../utils/apiClient';
import SpotifyPanel from './SpotifyPanel';

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(decimals);
}

function pct(n) { return `${fmt(n)}%`; }

function timeAgo(isoString) {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent = 'blue' }) {
  const colors = {
    blue:   'bg-blue-500/10   border-blue-500/20   text-blue-400',
    green:  'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    purple: 'bg-violet-500/10  border-violet-500/20  text-violet-400',
    amber:  'bg-amber-500/10   border-amber-500/20   text-amber-400',
  };
  return (
    <div className={`glass-card-interactive p-4 border ${colors[accent]} rounded-xl`}>
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-white font-heading">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function FeatureBar({ label, value, max = 100, color = 'bg-blue-500' }) {
  const w = Math.min(100, Math.max(0, value ?? 0));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400 font-mono">{fmt(w)}%</span>
      </div>
      <div className="progress-bar-bg">
        <div className={`progress-bar-fill ${color}`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

function GenrePill({ genre, pct: p }) {
  const genreColors = {
    pop:   'genre-pop', rap: 'genre-rap', rock: 'genre-rock',
    latin: 'genre-latin', 'r&b': 'genre-rnb', edm: 'genre-edm',
  };
  const cls = genreColors[genre?.toLowerCase()] || 'genre-other';
  return (
    <span className={`genre-badge ${cls}`}>
      {genre} <span className="opacity-70">{fmt(p)}%</span>
    </span>
  );
}

// ── Empty state templates ──────────────────────────────────────────────────

function EmptyNotLoggedIn({ onShowAuth }) {
  return (
    <div className="glass-panel p-12 text-center space-y-4 my-8">
      <User2 className="w-12 h-12 text-slate-600 mx-auto" />
      <h3 className="text-lg font-bold text-white">Sign in to see your music profile</h3>
      <p className="text-sm text-slate-400 max-w-sm mx-auto">
        Create a free MusicLens account, then connect Spotify to get a personal music intelligence report.
      </p>
      <button
        type="button"
        onClick={onShowAuth}
        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        Sign in / Register
      </button>
    </div>
  );
}

function EmptyNoSpotify() {
  return (
    <div className="glass-panel p-12 text-center space-y-4 my-8">
      <Music2 className="w-12 h-12 text-slate-600 mx-auto" />
      <h3 className="text-lg font-bold text-white">Connect Spotify to build your profile</h3>
      <p className="text-sm text-slate-400 max-w-md mx-auto">
        MusicLens will analyse your listening history, match your tracks to our 30K-song catalog,
        and build a personal audio profile — without storing any audio.
      </p>
      <div className="flex justify-center pt-2">
        <SpotifyPanel />
      </div>
    </div>
  );
}

function EmptyNoProfile({ onRefresh, refreshing }) {
  return (
    <div className="glass-panel p-12 text-center space-y-4 my-8">
      <Headphones className="w-12 h-12 text-slate-600 mx-auto" />
      <h3 className="text-lg font-bold text-white">Run your first music analysis</h3>
      <p className="text-sm text-slate-400 max-w-md mx-auto">
        Spotify is connected. Click below to fetch your listening data and calculate your MusicLens profile.
        This usually takes 5–15 seconds.
      </p>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        {refreshing
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Analysing…</>
          : <><Zap className="w-4 h-4" /> Analyse My Music</>}
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ProfileTab({ onShowAuth }) {
  const { user, spotifyConnected } = useAuth();

  const [profileData, setProfileData] = useState(null);   // full API response
  const [loading, setLoading]         = useState(false);  // initial fetch
  const [refreshing, setRefreshing]   = useState(false);  // POST /refresh
  const [error, setError]             = useState(null);

  // ── Load persisted profile on mount ────────────────────────────────────
  const loadProfile = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await profileApi.get();
      setProfileData(data);
    } catch (err) {
      if (err.status !== 401) setError(err.message || 'Could not load profile.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // ── Refresh (full Spotify sync + recalc) ───────────────────────────────
  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const data = await profileApi.refresh();
      // Merge into existing shape
      setProfileData((prev) => ({
        ...prev,
        hasProfile: data.hasProfile,
        profile: data.profile,
      }));
    } catch (err) {
      setError(err.message || 'Profile refresh failed.');
    } finally {
      setRefreshing(false);
    }
  }

  // ── Render guards ───────────────────────────────────────────────────────
  if (!user) return <EmptyNotLoggedIn onShowAuth={onShowAuth} />;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  if (!profileData?.spotifyConnected) return <EmptyNoSpotify />;

  if (!profileData?.hasProfile) {
    return <EmptyNoProfile onRefresh={handleRefresh} refreshing={refreshing} />;
  }

  const p = profileData.profile;
  const ap = p?.audio_profile;
  const genres = p?.dominant_genres || {};
  const artists = p?.top_artists || [];
  const moods = p?.mood_distribution || {};

  return (
    <div className="space-y-6 mt-4">

      {/* ── Error banner ─────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-950/30 border border-red-500/30 rounded-xl text-sm text-red-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-200 text-xs">Dismiss</button>
        </div>
      )}

      {/* ── Header bar ───────────────────────────────────────────────── */}
      <div className="glass-panel px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Music2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white font-heading">My Music Profile</h2>
            <p className="text-xs text-slate-400">
              Last synced: {timeAgo(p?.last_spotify_sync)} •
              <span className="text-slate-300"> {profileData.spotifyDisplayName || 'Spotify connected'}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SpotifyPanel />
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-300 hover:text-white transition-colors disabled:opacity-50"
          >
            {refreshing
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Coverage stats ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Tracks analysed"
          value={p?.tracks_analyzed ?? '—'}
          sub="from Spotify"
          accent="blue"
        />
        <StatCard
          label="Catalog matches"
          value={p?.tracks_matched ?? '—'}
          sub={`${p?.tracks_ambiguous ?? 0} ambiguous`}
          accent="green"
        />
        <StatCard
          label="Coverage"
          value={pct(p?.coverage_pct)}
          sub={`${p?.tracks_unmatched ?? 0} unmatched`}
          accent="purple"
        />
        <StatCard
          label="Liked tracks"
          value={profileData.likedTracksCount ?? 0}
          sub="manual likes"
          accent="amber"
        />
      </div>

      {/* ── Archetype card ────────────────────────────────────────────── */}
      {p?.archetype && (
        <div className="glass-panel p-5 border border-blue-500/20 bg-blue-950/10 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <Headphones className="w-5 h-5 text-blue-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-400">Music Personality</span>
          </div>
          <h3 className="text-xl font-bold text-white font-heading">{p.archetype}</h3>
          <p className="text-sm text-blue-300 italic">{p.archetype_tagline}</p>
          <p className="text-xs text-slate-400 leading-relaxed">{p.archetype_desc}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── Audio feature radar ───────────────────────────────────── */}
        {ap && (
          <div className="glass-panel p-5 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Waves className="w-4 h-4 text-violet-400" />
              <h4 className="text-sm font-semibold text-white">Audio Profile</h4>
            </div>
            <div className="space-y-2.5">
              <FeatureBar label="Energy"          value={ap.energy_pct}          color="bg-red-500" />
              <FeatureBar label="Danceability"    value={ap.danceability_pct}    color="bg-pink-500" />
              <FeatureBar label="Valence (mood)"  value={ap.valence_pct}         color="bg-yellow-500" />
              <FeatureBar label="Acousticness"    value={ap.acousticness_pct}    color="bg-emerald-500" />
              <FeatureBar label="Speechiness"     value={ap.speechiness_pct}     color="bg-blue-400" />
              <FeatureBar label="Instrumentalness" value={ap.instrumentalness_pct} color="bg-violet-500" />
              <FeatureBar label="Liveness"        value={ap.liveness_pct}        color="bg-orange-400" />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
              <div>
                <p className="text-xs text-slate-500">Avg Tempo</p>
                <p className="text-sm font-semibold text-white">{fmt(ap.avg_tempo_bpm, 0)} BPM</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Avg Loudness</p>
                <p className="text-sm font-semibold text-white">{fmt(ap.avg_loudness_db, 1)} dB</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Genres + mood ─────────────────────────────────────────── */}
        <div className="space-y-4">
          {Object.keys(genres).length > 0 && (
            <div className="glass-panel p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-amber-400" />
                <h4 className="text-sm font-semibold text-white">Dominant Genres</h4>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(genres)
                  .sort(([, a], [, b]) => b - a)
                  .map(([g, p]) => <GenrePill key={g} genre={g} pct={p} />)}
              </div>
            </div>
          )}

          {Object.keys(moods).length > 0 && (
            <div className="glass-panel p-5 space-y-3">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-blue-400" />
                <h4 className="text-sm font-semibold text-white">Mood Distribution</h4>
              </div>
              <div className="space-y-2">
                {Object.entries(moods)
                  .sort(([, a], [, b]) => b - a)
                  .map(([mood, val]) => (
                    <div key={mood} className="flex items-center gap-3 text-xs">
                      <span className="text-slate-300 w-40 flex-shrink-0">{mood}</span>
                      <div className="flex-1 progress-bar-bg">
                        <div
                          className="progress-bar-fill bg-indigo-500"
                          style={{ width: `${Math.min(100, val)}%` }}
                        />
                      </div>
                      <span className="text-slate-400 w-10 text-right font-mono">{fmt(val)}%</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Top Artists ──────────────────────────────────────────────── */}
      {artists.length > 0 && (
        <div className="glass-panel p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Mic2 className="w-4 h-4 text-pink-400" />
            <h4 className="text-sm font-semibold text-white">Top Artists in Your Catalog</h4>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {artists.slice(0, 10).map((a, i) => (
              <div
                key={a.artist}
                className="glass-card-interactive p-2.5 rounded-lg text-center"
              >
                <span className="text-[10px] text-slate-500 font-mono">#{i + 1}</span>
                <p className="text-xs font-semibold text-slate-200 mt-0.5 truncate" title={a.artist}>
                  {a.artist}
                </p>
                <p className="text-[10px] text-slate-500">{a.track_count} track{a.track_count !== 1 ? 's' : ''}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Coverage footnote ─────────────────────────────────────────── */}
      <p className="text-xs text-slate-600 text-center pb-4">
        Coverage reflects how many of your Spotify tracks appear in the MusicLens 30K catalog.
        Unmatched tracks are displayed for transparency but excluded from audio calculations.
      </p>

    </div>
  );
}
