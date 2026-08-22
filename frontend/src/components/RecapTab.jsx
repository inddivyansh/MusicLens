/**
 * frontend/src/components/RecapTab.jsx
 * MusicLens Recap — data-driven summary of the user's music profile.
 * Sourced entirely from persisted user_profile_data (no Spotify calls on render).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Music2, Loader2, AlertCircle, RefreshCw, Sparkles,
  Headphones, BarChart2, Mic2, Waves, Lightbulb,
  TrendingUp, User2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { recapApi, ApiError } from '../utils/apiClient';
import SpotifyPanel from './SpotifyPanel';

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(n, dec = 1) { return n != null && !isNaN(n) ? Number(n).toFixed(dec) : '—'; }
function pctBar(val, color = 'bg-blue-500') {
  const w = Math.min(100, Math.max(0, val ?? 0));
  return (
    <div className="progress-bar-bg flex-1">
      <div className={`progress-bar-fill ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

const GENRE_COLORS = { pop: 'genre-pop', rap: 'genre-rap', rock: 'genre-rock',
                       latin: 'genre-latin', 'r&b': 'genre-rnb', edm: 'genre-edm' };

function timeAgo(iso) {
  if (!iso) return 'Never';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Empty states ───────────────────────────────────────────────────────────
function EmptyNotLoggedIn({ onShowAuth }) {
  return (
    <div className="glass-panel p-12 text-center space-y-4 my-8">
      <User2 className="w-12 h-12 text-slate-600 mx-auto" />
      <h3 className="text-lg font-bold text-white">Sign in to see your Recap</h3>
      <p className="text-sm text-slate-400 max-w-sm mx-auto">
        Your Recap is a personal MusicLens analysis of your listening taste — powered by your Spotify data.
      </p>
      <button type="button" onClick={onShowAuth}
        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors">
        Sign in / Register
      </button>
    </div>
  );
}

function EmptyNoProfile() {
  return (
    <div className="glass-panel p-12 text-center space-y-4 my-8">
      <Music2 className="w-12 h-12 text-slate-600 mx-auto" />
      <h3 className="text-lg font-bold text-white">No Recap available yet</h3>
      <p className="text-sm text-slate-400 max-w-md mx-auto">
        Connect your Spotify account and run your first music analysis (My Music tab) to generate your Recap.
      </p>
      <div className="flex justify-center">
        <SpotifyPanel />
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function RecapTab({ onShowAuth }) {
  const { user } = useAuth();

  const [recapData, setRecapData] = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const loadRecap = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await recapApi.get();
      setRecapData(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(err.message || 'Could not load recap.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadRecap(); }, [loadRecap]);

  if (!user)          return <EmptyNotLoggedIn onShowAuth={onShowAuth} />;
  if (loading)        return <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 text-blue-400 animate-spin" /></div>;
  if (error)          return (
    <div className="glass-panel p-8 my-8 border border-red-500/30 bg-red-950/20 text-center space-y-3">
      <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
      <p className="text-sm text-red-300">{error}</p>
      <button type="button" onClick={loadRecap} className="text-xs text-red-400 hover:text-red-200 flex items-center gap-1 mx-auto">
        <RefreshCw className="w-3 h-3" /> Retry
      </button>
    </div>
  );
  if (!recapData?.hasRecap) return <EmptyNoProfile />;

  const { recap } = recapData;
  const { overview, audioProfile, topGenres, topArtists, moodDistribution, personality, tasteHighlights } = recap;

  return (
    <div className="space-y-6 mt-4">

      {/* ── Hero header ────────────────────────────────────────────────── */}
      <div className="glass-panel p-6 bg-gradient-to-r from-violet-950/40 via-slate-900/60 to-blue-950/40 border border-violet-500/20 text-center space-y-2">
        <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-400 mb-1">
          <Sparkles className="w-4 h-4" />
          Your MusicLens Recap
        </div>
        <h1 className="text-3xl font-extrabold text-white font-heading">
          {personality.archetype}
        </h1>
        <p className="text-sm text-violet-300 italic max-w-xl mx-auto">"{personality.tagline}"</p>
        <p className="text-xs text-slate-400 max-w-2xl mx-auto">{personality.desc}</p>
        <p className="text-xs text-slate-500 pt-1">
          Last updated: {timeAgo(overview.last_refreshed_at)} •
          Synced from Spotify: {timeAgo(overview.last_spotify_sync)}
        </p>
      </div>

      {/* ── Overview stats ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Tracks analyzed', value: overview.tracks_analyzed, accent: 'border-blue-500/20 bg-blue-500/5' },
          { label: 'Catalog matches', value: overview.tracks_matched,  accent: 'border-emerald-500/20 bg-emerald-500/5' },
          { label: 'Coverage',        value: `${fmt(overview.coverage_pct)}%`, accent: 'border-violet-500/20 bg-violet-500/5' },
          { label: 'Unmatched',       value: overview.tracks_unmatched, accent: 'border-slate-700 bg-slate-900/40' },
        ].map(({ label, value, accent }) => (
          <div key={label} className={`glass-panel p-4 border ${accent} rounded-xl text-center`}>
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            <p className="text-2xl font-bold text-white font-heading">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── Audio profile ────────────────────────────────────────────── */}
        <div className="glass-panel p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Waves className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-semibold text-white">Audio DNA</h3>
          </div>
          <div className="space-y-2.5">
            {[
              { label: 'Energy',          val: audioProfile.energy_pct,          color: 'bg-red-500' },
              { label: 'Danceability',    val: audioProfile.danceability_pct,    color: 'bg-pink-500' },
              { label: 'Valence (mood)',  val: audioProfile.valence_pct,         color: 'bg-yellow-500' },
              { label: 'Acousticness',    val: audioProfile.acousticness_pct,    color: 'bg-emerald-500' },
              { label: 'Speechiness',     val: audioProfile.speechiness_pct,     color: 'bg-blue-400' },
              { label: 'Instrumentalness', val: audioProfile.instrumentalness_pct, color: 'bg-violet-500' },
              { label: 'Liveness',        val: audioProfile.liveness_pct,        color: 'bg-orange-400' },
            ].map(({ label, val, color }) => (
              <div key={label} className="flex items-center gap-3 text-xs">
                <span className="text-slate-300 w-32 flex-shrink-0">{label}</span>
                {pctBar(val, color)}
                <span className="text-slate-400 w-10 text-right font-mono">{fmt(val)}%</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800 text-xs">
            <div>
              <p className="text-slate-500">Avg Tempo</p>
              <p className="font-semibold text-white">{fmt(audioProfile.avg_tempo_bpm, 0)} BPM</p>
            </div>
            <div>
              <p className="text-slate-500">Avg Loudness</p>
              <p className="font-semibold text-white">{fmt(audioProfile.avg_loudness_db, 1)} dB</p>
            </div>
          </div>
        </div>

        {/* ── Genres + Mood ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          {topGenres.length > 0 && (
            <div className="glass-panel p-5 space-y-3">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-white">Top Genres</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {topGenres.map(({ genre, pct: p }) => (
                  <span key={genre} className={`genre-badge ${GENRE_COLORS[genre?.toLowerCase()] || 'genre-other'}`}>
                    {genre} <span className="opacity-70">{fmt(p)}%</span>
                  </span>
                ))}
              </div>
              <div className="space-y-1.5 pt-1">
                {topGenres.map(({ genre, pct: p }) => (
                  <div key={genre} className="flex items-center gap-3 text-xs">
                    <span className="text-slate-300 w-16 capitalize">{genre}</span>
                    {pctBar(p, 'bg-amber-500')}
                    <span className="text-slate-400 font-mono w-10 text-right">{fmt(p)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Object.keys(moodDistribution).length > 0 && (
            <div className="glass-panel p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Headphones className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-white">Mood Distribution</h3>
              </div>
              {Object.entries(moodDistribution).sort(([,a],[,b]) => b-a).map(([mood, val]) => (
                <div key={mood} className="flex items-center gap-3 text-xs">
                  <span className="text-slate-300 w-40 flex-shrink-0">{mood}</span>
                  {pctBar(val, 'bg-indigo-500')}
                  <span className="text-slate-400 font-mono w-10 text-right">{fmt(val)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Top Artists ─────────────────────────────────────────────────── */}
      {topArtists.length > 0 && (
        <div className="glass-panel p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Mic2 className="w-4 h-4 text-pink-400" />
            <h3 className="text-sm font-semibold text-white">Top Artists in Your Catalog</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {topArtists.map((a, i) => (
              <div key={a.artist} className="glass-card-interactive p-3 rounded-xl text-center">
                <span className="text-[10px] text-slate-500 font-mono">#{i + 1}</span>
                <p className="text-xs font-semibold text-slate-200 mt-0.5 truncate" title={a.artist}>{a.artist}</p>
                <p className="text-[10px] text-slate-500">{a.track_count} track{a.track_count !== 1 ? 's' : ''}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Taste highlights ────────────────────────────────────────────── */}
      {tasteHighlights.length > 0 && (
        <div className="glass-panel p-5 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Lightbulb className="w-4 h-4 text-yellow-400" />
            <h3 className="text-sm font-semibold text-white">Taste Highlights</h3>
            <span className="text-xs text-slate-500">— calculated from your MusicLens profile</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tasteHighlights.map((h, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-slate-900/60 border border-slate-800 rounded-xl">
                <TrendingUp className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-slate-300">{h.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-600 text-center pb-4">
        MusicLens analyzed {overview.tracks_matched} matched tracks from your connected music data.
        Coverage: {fmt(overview.coverage_pct)}% of your Spotify tracks found in the 30K catalog.
      </p>

    </div>
  );
}
