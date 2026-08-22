import React, { useState, useEffect, useCallback } from 'react';
import {
  Music2,
  Loader2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Headphones,
  BarChart2,
  Mic2,
  Waves,
  Lightbulb,
  TrendingUp,
  User2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { recapApi, ApiError } from '../utils/apiClient';
import SectionHeader from './ui/SectionHeader';
import KpiStat from './ui/KpiStat';
import StatBar from './ui/StatBar';
import Pill from './ui/Pill';
import EmptyState from './ui/EmptyState';

function fmt(n, dec = 1) {
  return n != null && !isNaN(n) ? Number(n).toFixed(dec) : '—';
}

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

export default function RecapTab({ onShowAuth }) {
  const { user } = useAuth();

  const [recapData, setRecapData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  useEffect(() => {
    loadRecap();
  }, [loadRecap]);

  if (!user) {
    return (
      <EmptyState
        icon={User2}
        title="Sign in to view your Recap"
        message="Your Recap is a personalized retrospective of your music taste and listening personality."
        actionText="Sign in / Register"
        onAction={onShowAuth}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel p-8 my-8 border-red-500/20 bg-red-950/20 text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
        <p className="text-sm text-red-300">{error}</p>
        <button
          type="button"
          onClick={loadRecap}
          className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 mx-auto"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  }

  if (!recapData?.hasRecap) {
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Year in Sound"
          title="Your MusicLens Recap"
          description="A shareable retrospective of your listening personality, top genres, and acoustic DNA."
        />
        <EmptyState
          icon={Music2}
          title="No Recap available yet"
          message="Connect your Spotify account and run your first music analysis in the My Music tab to generate your personalized Recap."
        />
      </div>
    );
  }

  const { recap } = recapData;
  const {
    overview,
    audioProfile,
    topGenres,
    topArtists,
    moodDistribution,
    personality,
    tasteHighlights,
  } = recap;

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <SectionHeader
        eyebrow="Year in Sound"
        title="Your MusicLens Recap"
        description="A shareable summary of your music personality, top genres, and acoustic fingerprints."
      />

      {/* Wrapped-Style Archetype Hero Card */}
      <div className="glass-panel p-8 sm:p-10 border-purple-500/30 bg-gradient-to-br from-[#1e1533] via-[#140e24] to-[#0b0713] text-center space-y-3 relative overflow-hidden shadow-2xl shadow-purple-950/40">
        <div className="pointer-events-none absolute -right-16 -top-16 w-64 h-64 rounded-full bg-purple-600/15 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 -bottom-16 w-64 h-64 rounded-full bg-indigo-600/15 blur-3xl" />

        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-xs font-bold uppercase tracking-wider text-purple-400 mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            Your Listening Archetype
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white font-heading tracking-tight">
            {personality.archetype}
          </h2>
          <p className="text-base text-purple-300 font-medium italic max-w-xl mx-auto">
            "{personality.tagline}"
          </p>
          <p className="text-xs text-[#a1a1c2] max-w-2xl mx-auto leading-relaxed pt-1">
            {personality.desc}
          </p>
          <p className="text-[11px] text-[#6b6b8f] pt-2">
            Last updated: {timeAgo(overview.last_refreshed_at)} • Synced from Spotify: {timeAgo(overview.last_spotify_sync)}
          </p>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <KpiStat
          label="Tracks Analyzed"
          value={overview.tracks_analyzed}
          sub="from your Spotify"
          icon={Music2}
          accent="purple"
          highlight={true}
        />
        <KpiStat
          label="Catalog Matches"
          value={overview.tracks_matched}
          sub="matched songs"
          icon={Sparkles}
          accent="indigo"
        />
        <KpiStat
          label="Coverage"
          value={`${fmt(overview.coverage_pct)}%`}
          sub="catalog share"
          icon={TrendingUp}
          accent="cyan"
        />
        <KpiStat
          label="Unmatched"
          value={overview.tracks_unmatched}
          sub="rare/indie tracks"
          icon={Headphones}
          accent="amber"
        />
      </div>

      {/* Audio DNA and Genres Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Audio DNA */}
        <div className="glass-panel p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Waves className="w-4 h-4 text-purple-400" />
            <h3 className="text-base font-bold text-white font-heading">Acoustic DNA</h3>
          </div>
          <div className="space-y-3.5">
            <StatBar label="Energy" value={audioProfile.energy_pct} colorClass="bg-purple-500" />
            <StatBar label="Danceability" value={audioProfile.danceability_pct} colorClass="bg-indigo-500" />
            <StatBar label="Valence (Mood)" value={audioProfile.valence_pct} colorClass="bg-pink-500" />
            <StatBar label="Acousticness" value={audioProfile.acousticness_pct} colorClass="bg-teal-500" />
            <StatBar label="Speechiness" value={audioProfile.speechiness_pct} colorClass="bg-amber-500" />
            <StatBar label="Instrumentalness" value={audioProfile.instrumentalness_pct} colorClass="bg-cyan-500" />
            <StatBar label="Liveness" value={audioProfile.liveness_pct} colorClass="bg-orange-500" />
          </div>
          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/5 font-mono text-center">
            <div className="p-2.5 bg-[#1e1533]/60 rounded-xl border border-white/5">
              <span className="text-[10px] text-[#6b6b8f] uppercase block">Avg Tempo</span>
              <span className="text-sm font-bold text-white">{fmt(audioProfile.avg_tempo_bpm, 0)} BPM</span>
            </div>
            <div className="p-2.5 bg-[#1e1533]/60 rounded-xl border border-white/5">
              <span className="text-[10px] text-[#6b6b8f] uppercase block">Avg Loudness</span>
              <span className="text-sm font-bold text-white">{fmt(audioProfile.avg_loudness_db, 1)} dB</span>
            </div>
          </div>
        </div>

        {/* Top Genres & Mood */}
        <div className="space-y-6">
          {topGenres.length > 0 && (
            <div className="glass-panel p-6 space-y-4">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-amber-400" />
                <h3 className="text-base font-bold text-white font-heading">Top Genres</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {topGenres.map(({ genre, pct: p }) => (
                  <Pill key={genre} label={`${genre} • ${fmt(p)}%`} genre={genre} size="md" />
                ))}
              </div>
              <div className="space-y-2.5 pt-2">
                {topGenres.map(({ genre, pct: p }) => (
                  <StatBar
                    key={genre}
                    label={genre}
                    value={p}
                    displayValue={`${fmt(p)}%`}
                    colorClass="bg-amber-500"
                  />
                ))}
              </div>
            </div>
          )}

          {Object.keys(moodDistribution).length > 0 && (
            <div className="glass-panel p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Headphones className="w-4 h-4 text-purple-400" />
                <h3 className="text-base font-bold text-white font-heading">Mood Profile</h3>
              </div>
              <div className="space-y-3">
                {Object.entries(moodDistribution)
                  .sort(([, a], [, b]) => b - a)
                  .map(([mood, val]) => (
                    <StatBar
                      key={mood}
                      label={mood}
                      value={val}
                      displayValue={`${fmt(val)}%`}
                      colorClass="bg-purple-500"
                    />
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top Artists in Recap */}
      {topArtists.length > 0 && (
        <div className="glass-panel p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Mic2 className="w-4 h-4 text-purple-400" />
            <h3 className="text-base font-bold text-white font-heading">Top Artists in Your Listening</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {topArtists.map((a, i) => (
              <div key={a.artist} className="glass-card-interactive p-3 rounded-xl text-center space-y-1">
                <span className="text-[10px] font-mono text-purple-400 font-bold block">#{i + 1}</span>
                <p className="text-xs font-semibold text-white truncate" title={a.artist}>
                  {a.artist}
                </p>
                <p className="text-[10px] text-[#6b6b8f]">
                  {a.track_count} track{a.track_count !== 1 ? 's' : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Taste Highlights */}
      {tasteHighlights.length > 0 && (
        <div className="glass-panel p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-300" />
            <h3 className="text-base font-bold text-white font-heading">Taste Highlights</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tasteHighlights.map((h, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-[#1e1533]/60 border border-white/5 rounded-xl">
                <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                <p className="text-xs text-[#a1a1c2] leading-relaxed">{h.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
