import React, { useState, useEffect, useCallback } from 'react';
import {
  Music2,
  RefreshCw,
  Loader2,
  AlertCircle,
  Zap,
  Headphones,
  BarChart2,
  User2,
  Radio,
  Waves,
  Mic2,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { profileApi } from '../utils/apiClient';
import SectionHeader from './ui/SectionHeader';
import KpiStat from './ui/KpiStat';
import StatBar from './ui/StatBar';
import Pill from './ui/Pill';
import EmptyState from './ui/EmptyState';
import SpotifyPanel from './SpotifyPanel';

function fmt(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(decimals);
}

function pct(n) {
  return `${fmt(n)}%`;
}

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

export default function ProfileTab({ onShowAuth }) {
  const { user } = useAuth();

  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

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

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const data = await profileApi.refresh();
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

  if (!user) {
    return (
      <EmptyState
        icon={User2}
        title="Sign in to view your profile"
        message="Create or log in to your account, then connect Spotify to unlock your personalized music taste profile."
        actionText="Sign in / Register"
        onAction={onShowAuth}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
      </div>
    );
  }

  if (!profileData?.spotifyConnected) {
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Personal Insights"
          title="Connect Your Spotify"
          description="Connect Spotify to calculate your personalized taste profile, favorite genres, and sonic personality."
        />
        <EmptyState
          icon={Music2}
          title="Connect Spotify to build your profile"
          message="MusicLens analyzes your top tracks, liked songs, and recently played music to construct your personal audio fingerprint."
        />
      </div>
    );
  }

  if (!profileData?.hasProfile) {
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Personal Insights"
          title="Your Music Profile"
          description="Analyze your Spotify listening history to build your MusicLens profile."
        />
        <EmptyState
          icon={Sparkles}
          title="Generate your taste profile"
          message="Your Spotify is connected! Click below to analyze your songs and compute your personal music personality."
          actionText={refreshing ? 'Analyzing…' : 'Analyze My Music'}
          onAction={handleRefresh}
        />
      </div>
    );
  }

  const p = profileData.profile;
  const ap = p?.audio_profile;
  const genres = p?.dominant_genres || {};
  const artists = p?.top_artists || [];
  const moods = p?.mood_distribution || {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <SectionHeader
        eyebrow="Personal Insights"
        title="My Music Profile"
        description={`Last synced: ${timeAgo(p?.last_spotify_sync)} • ${profileData.spotifyDisplayName || 'Spotify Connected'}`}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#1e1533] hover:bg-[#2a1f45] border border-white/10 text-xs font-semibold text-white transition-all disabled:opacity-50"
            >
              {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>{refreshing ? 'Syncing…' : 'Sync Spotify'}</span>
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-950/20 border border-red-500/20 rounded-xl text-xs text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="font-bold text-red-400 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Coverage Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
        <KpiStat
          label="Tracks Analyzed"
          value={p?.tracks_analyzed ?? '—'}
          sub="from Spotify"
          icon={Music2}
          accent="purple"
          highlight={true}
        />
        <KpiStat
          label="Catalog Matches"
          value={p?.tracks_matched ?? '—'}
          sub={`${p?.tracks_ambiguous ?? 0} ambiguous`}
          icon={Zap}
          accent="indigo"
        />
        <KpiStat
          label="Catalog Coverage"
          value={pct(p?.coverage_pct)}
          sub="matched share"
          icon={Sparkles}
          accent="cyan"
        />
        <KpiStat
          label="Liked Tracks"
          value={profileData.likedTracksCount ?? 0}
          sub="user library"
          icon={Headphones}
          accent="amber"
        />
      </div>

      {/* Personality Archetype Hero */}
      {p?.archetype && (
        <div className="glass-panel p-6 border-purple-500/20 bg-gradient-to-r from-[#1e1533] via-[#140e24] to-[#0b0713] space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-purple-400">
              Music Personality Archetype
            </span>
          </div>
          <h2 className="text-2xl font-extrabold text-white font-heading">{p.archetype}</h2>
          <p className="text-sm text-purple-300 font-medium italic">{p.archetype_tagline}</p>
          <p className="text-xs text-[#a1a1c2] leading-relaxed max-w-3xl">{p.archetype_desc}</p>
        </div>
      )}

      {/* Audio Features and Genres Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Audio Feature Breakdown */}
        {ap && (
          <div className="glass-panel p-6 space-y-5">
            <div className="flex items-center gap-2">
              <Waves className="w-4 h-4 text-purple-400" />
              <h3 className="text-base font-bold text-white font-heading">Audio Signature</h3>
            </div>
            <div className="space-y-3.5">
              <StatBar label="Energy" value={ap.energy_pct} colorClass="bg-purple-500" />
              <StatBar label="Danceability" value={ap.danceability_pct} colorClass="bg-indigo-500" />
              <StatBar label="Valence (Mood)" value={ap.valence_pct} colorClass="bg-pink-500" />
              <StatBar label="Acousticness" value={ap.acousticness_pct} colorClass="bg-teal-500" />
              <StatBar label="Speechiness" value={ap.speechiness_pct} colorClass="bg-amber-500" />
              <StatBar label="Instrumentalness" value={ap.instrumentalness_pct} colorClass="bg-cyan-500" />
              <StatBar label="Liveness" value={ap.liveness_pct} colorClass="bg-orange-500" />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/5 font-mono">
              <div className="p-2.5 bg-[#1e1533]/60 rounded-xl border border-white/5 text-center">
                <span className="text-[10px] text-[#6b6b8f] uppercase block">Avg Tempo</span>
                <span className="text-sm font-bold text-white">{fmt(ap.avg_tempo_bpm, 0)} BPM</span>
              </div>
              <div className="p-2.5 bg-[#1e1533]/60 rounded-xl border border-white/5 text-center">
                <span className="text-[10px] text-[#6b6b8f] uppercase block">Avg Loudness</span>
                <span className="text-sm font-bold text-white">{fmt(ap.avg_loudness_db, 1)} dB</span>
              </div>
            </div>
          </div>
        )}

        {/* Dominant Genres & Mood */}
        <div className="space-y-6">
          {Object.keys(genres).length > 0 && (
            <div className="glass-panel p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-amber-400" />
                <h3 className="text-base font-bold text-white font-heading">Dominant Genres</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(genres)
                  .sort(([, a], [, b]) => b - a)
                  .map(([g, val]) => (
                    <Pill key={g} label={`${g} • ${fmt(val)}%`} genre={g} size="md" />
                  ))}
              </div>
            </div>
          )}

          {Object.keys(moods).length > 0 && (
            <div className="glass-panel p-6 space-y-4">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-purple-400" />
                <h3 className="text-base font-bold text-white font-heading">Mood Distribution</h3>
              </div>
              <div className="space-y-3">
                {Object.entries(moods)
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

      {/* Top Artists Grid */}
      {artists.length > 0 && (
        <div className="glass-panel p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Mic2 className="w-4 h-4 text-purple-400" />
            <h3 className="text-base font-bold text-white font-heading">Top Artists in Your Listening</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {artists.slice(0, 10).map((a, i) => (
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
    </div>
  );
}
