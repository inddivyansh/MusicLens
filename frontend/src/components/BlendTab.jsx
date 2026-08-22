/**
 * frontend/src/components/BlendTab.jsx
 * Friend Blend — compare music taste between two MusicLens users.
 *
 * States: idle → creating → invited → (friend joins) → result
 *         invite URL → joining → result
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Loader2, AlertCircle, RefreshCw, Copy, CheckCircle2,
  Users, Music2, BarChart2, UserCircle2, Heart, ArrowRight,
  Link2, Waves, Mic2, TrendingUp, TrendingDown, Info, Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { blendApi, ApiError } from '../utils/apiClient';

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
function timeAgo(iso) {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const GENRE_COLORS = { pop: 'genre-pop', rap: 'genre-rap', rock: 'genre-rock',
                       latin: 'genre-latin', 'r&b': 'genre-rnb', edm: 'genre-edm' };

function scoreColor(score) {
  if (score >= 85) return 'text-emerald-400';
  if (score >= 70) return 'text-blue-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}
function scoreBg(score) {
  if (score >= 85) return 'from-emerald-950/40 via-slate-900/60 to-teal-950/40 border-emerald-500/20';
  if (score >= 70) return 'from-blue-950/40 via-slate-900/60 to-indigo-950/40 border-blue-500/20';
  if (score >= 50) return 'from-amber-950/40 via-slate-900/60 to-orange-950/40 border-amber-500/20';
  return 'from-red-950/40 via-slate-900/60 to-rose-950/40 border-red-500/20';
}
function scoreLabel(score) {
  if (score >= 90) return 'Soul Mates 🎶';
  if (score >= 80) return 'Music Twins ✨';
  if (score >= 70) return 'Great Match 🤝';
  if (score >= 60) return 'Good Vibes 🎵';
  if (score >= 50) return 'Interesting Mix 🎧';
  return 'Opposites Attract 🔀';
}

// ── Empty / not-logged-in states ──────────────────────────────────────────
function EmptyNotLoggedIn({ onShowAuth }) {
  return (
    <div className="glass-panel p-12 text-center space-y-4 my-8">
      <UserCircle2 className="w-12 h-12 text-slate-600 mx-auto" />
      <h3 className="text-lg font-bold text-white">Sign in to Blend</h3>
      <p className="text-sm text-slate-400 max-w-sm mx-auto">
        Compare your music taste with a friend. Both users need a MusicLens account.
      </p>
      <button type="button" onClick={onShowAuth}
        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors">
        Sign in / Register
      </button>
    </div>
  );
}

// ── Blend Result Display ──────────────────────────────────────────────────
function BlendResult({ result, creatorEmail, participantEmail }) {
  const {
    blendScore, vectorSimilarity, featureCompatibility, genreAnalysis,
    sharedTraits, biggestDifferences, sharedArtists, sharedRecommendations,
  } = result;

  return (
    <div className="space-y-6">

      {/* ── Blend Score Hero ──────────────────────────────────────────── */}
      <div className={`glass-panel p-8 bg-gradient-to-r ${scoreBg(blendScore)} border text-center space-y-3`}>
        <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-400 mb-1">
          <Sparkles className="w-4 h-4" />
          Music Taste Blend Score
        </div>
        <div className={`text-6xl font-extrabold font-heading ${scoreColor(blendScore)}`}>
          {fmt(blendScore, 0)}
        </div>
        <p className="text-lg font-semibold text-white">{scoreLabel(blendScore)}</p>
        <p className="text-xs text-slate-400">
          Vector similarity: {fmt(vectorSimilarity)}% •
          Genre overlap: {fmt(genreAnalysis.similarity)}%
        </p>
        <div className="flex items-center justify-center gap-3 text-xs text-slate-500 pt-2">
          <span className="px-2.5 py-1 bg-slate-900/80 rounded-lg border border-slate-800">
            {creatorEmail}
          </span>
          <span className="text-slate-600">×</span>
          <span className="px-2.5 py-1 bg-slate-900/80 rounded-lg border border-slate-800">
            {participantEmail}
          </span>
        </div>
      </div>

      {/* ── Overview cards ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Shared traits */}
        <div className="glass-panel p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-pink-400" />
            <h3 className="text-sm font-semibold text-white">You Both Love</h3>
          </div>
          <div className="space-y-2">
            {sharedTraits.map((t) => (
              <div key={t.feature} className="flex items-center gap-3 text-xs">
                <span className="text-slate-300 w-32 capitalize flex-shrink-0">{t.feature}</span>
                {pctBar(t.compatibility, 'bg-pink-500')}
                <span className="text-slate-400 w-16 text-right font-mono">{fmt(t.compatibility)}%</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  t.compatibility >= 90 ? 'bg-emerald-950 text-emerald-400'
                  : t.compatibility >= 75 ? 'bg-blue-950 text-blue-400'
                  : 'bg-slate-800 text-slate-400'
                }`}>{t.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Biggest differences */}
        <div className="glass-panel p-5 space-y-3">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">Biggest Differences</h3>
          </div>
          <div className="space-y-2">
            {biggestDifferences.map((d) => (
              <div key={d.feature} className="flex items-center gap-3 text-xs">
                <span className="text-slate-300 w-32 capitalize flex-shrink-0">{d.feature}</span>
                {pctBar(d.compatibility, 'bg-amber-500')}
                <span className="text-slate-400 w-16 text-right font-mono">{fmt(d.compatibility)}%</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  d.compatibility < 50 ? 'bg-red-950 text-red-400'
                  : d.compatibility < 70 ? 'bg-amber-950 text-amber-400'
                  : 'bg-slate-800 text-slate-400'
                }`}>{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Feature Compatibility ──────────────────────────────────────── */}
      <div className="glass-panel p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Waves className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-white">Feature Compatibility</h3>
        </div>
        <div className="space-y-2.5">
          {featureCompatibility.map((f) => (
            <div key={f.feature} className="flex items-center gap-3 text-xs">
              <span className="text-slate-300 w-32 capitalize flex-shrink-0">{f.feature}</span>
              <span className="text-slate-500 w-12 text-right font-mono">{fmt(f.userA, 2)}</span>
              {pctBar(f.compatibility, f.compatibility >= 80 ? 'bg-emerald-500' : f.compatibility >= 60 ? 'bg-blue-500' : 'bg-amber-500')}
              <span className="text-slate-500 w-12 text-right font-mono">{fmt(f.userB, 2)}</span>
              <span className={`font-mono w-14 text-right font-bold ${
                f.compatibility >= 80 ? 'text-emerald-400' : f.compatibility >= 60 ? 'text-blue-400' : 'text-amber-400'
              }`}>{fmt(f.compatibility)}%</span>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-slate-600 pt-1 border-t border-slate-800">
          <span>← {creatorEmail}</span>
          <span>{participantEmail} →</span>
        </div>
      </div>

      {/* ── Genre Analysis ─────────────────────────────────────────────── */}
      {genreAnalysis.shared.length > 0 && (
        <div className="glass-panel p-5 space-y-3">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-white">Shared Genres</h3>
            <span className="text-xs text-slate-500">Genre similarity: {fmt(genreAnalysis.similarity)}%</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {genreAnalysis.shared.map(({ genre, pctA, pctB }) => (
              <span key={genre} className={`genre-badge ${GENRE_COLORS[genre?.toLowerCase()] || 'genre-other'}`}>
                {genre}
                <span className="opacity-70 ml-1">{fmt(pctA, 0)}% / {fmt(pctB, 0)}%</span>
              </span>
            ))}
          </div>
          {(genreAnalysis.onlyA.length > 0 || genreAnalysis.onlyB.length > 0) && (
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800">
              {genreAnalysis.onlyA.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">Only {creatorEmail.split('@')[0]}</p>
                  <div className="flex flex-wrap gap-1">
                    {genreAnalysis.onlyA.map(({ genre }) => (
                      <span key={genre} className="text-[10px] px-2 py-0.5 bg-slate-800 text-slate-400 rounded capitalize">{genre}</span>
                    ))}
                  </div>
                </div>
              )}
              {genreAnalysis.onlyB.length > 0 && (
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">Only {participantEmail.split('@')[0]}</p>
                  <div className="flex flex-wrap gap-1">
                    {genreAnalysis.onlyB.map(({ genre }) => (
                      <span key={genre} className="text-[10px] px-2 py-0.5 bg-slate-800 text-slate-400 rounded capitalize">{genre}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Shared Artists ──────────────────────────────────────────────── */}
      {sharedArtists.length > 0 && (
        <div className="glass-panel p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Mic2 className="w-4 h-4 text-pink-400" />
            <h3 className="text-sm font-semibold text-white">Artists You Both Listen To</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {sharedArtists.map((a) => (
              <span key={a} className="px-3 py-1.5 bg-slate-900/80 border border-slate-800 rounded-lg text-xs text-slate-200 font-medium">
                {a}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Shared Recommendations ─────────────────────────────────────── */}
      {sharedRecommendations.length > 0 && (
        <div className="glass-panel p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Recommended for Both of You</h3>
            <span className="text-xs text-slate-500 ml-1">{sharedRecommendations.length} tracks</span>
          </div>
          <div className="space-y-2.5">
            {sharedRecommendations.map((rec) => (
              <div key={rec.track_id} className="p-3.5 bg-slate-900/60 border border-slate-800 hover:border-emerald-500/30 rounded-xl transition-all space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 truncate">
                    <span className="text-xs font-mono text-slate-500 w-5">#{rec.rank}</span>
                    <div className="truncate">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-slate-100">{rec.track_name}</span>
                        {rec.genre_name && (
                          <span className={`genre-badge text-[9px] ${GENRE_COLORS[(rec.genre_name.split(', ')[0] || '').toLowerCase()] || 'genre-other'}`}>
                            {rec.genre_name.split(', ')[0]}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400">by {rec.artist_name}</span>
                    </div>
                  </div>
                  <span className="font-bold text-sm text-emerald-400 font-mono flex-shrink-0">
                    {rec.similarity_pct}%
                  </span>
                </div>
                {rec.explanation?.narrative && (
                  <div className="text-[11px] text-slate-500 flex items-start gap-1.5">
                    <Info className="w-3 h-3 flex-shrink-0 mt-0.5 text-blue-400" />
                    <span>{rec.explanation.narrative}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Blend card (for list view) ────────────────────────────────────────────
function BlendCard({ blend, onView }) {
  const statusBadge = {
    pending:   'bg-amber-950 text-amber-400 border-amber-800',
    accepted:  'bg-blue-950 text-blue-400 border-blue-800',
    completed: 'bg-emerald-950 text-emerald-400 border-emerald-800',
    expired:   'bg-slate-800 text-slate-500 border-slate-700',
  };

  return (
    <div className="p-4 bg-slate-900/60 border border-slate-800 hover:border-slate-700 rounded-xl transition-all">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Users className="w-5 h-5 text-violet-400 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-200 truncate">
              Blend with {blend.partnerEmail || '(waiting for friend)'}
            </p>
            <p className="text-[11px] text-slate-500">
              {blend.role === 'creator' ? 'Created' : 'Joined'} {timeAgo(blend.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-[10px] px-2 py-0.5 rounded-md border capitalize ${statusBadge[blend.status] || statusBadge.expired}`}>
            {blend.status}
          </span>
          {(blend.status === 'completed' || blend.status === 'accepted') && (
            <button type="button" onClick={() => onView(blend.blendId)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white transition-colors">
              View
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function BlendTab({ onShowAuth, initialInviteToken }) {
  const { user } = useAuth();

  // States
  const [view, setView]             = useState('list'); // list | invite | join | detail
  const [blends, setBlends]         = useState([]);
  const [blendDetail, setBlendDetail] = useState(null);
  const [inviteData, setInviteData] = useState(null);
  const [inviteToken, setInviteToken] = useState(initialInviteToken || '');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [copied, setCopied]         = useState(false);

  // ── Load blends list ─────────────────────────────────────────────────
  const loadBlends = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await blendApi.list();
      setBlends(data.blends || []);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setError(err.message || 'Could not load blends.');
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user && view === 'list') loadBlends();
  }, [user, view, loadBlends]);

  // ── Handle initial invite token from URL ─────────────────────────────
  useEffect(() => {
    if (initialInviteToken && user) {
      setInviteToken(initialInviteToken);
      setView('join');
    } else if (initialInviteToken && !user) {
      setInviteToken(initialInviteToken);
    }
  }, [initialInviteToken, user]);

  // ── Create blend ─────────────────────────────────────────────────────
  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const data = await blendApi.create();
      setInviteData(data);
      setView('invite');
    } catch (err) {
      setError(err.message || 'Could not create blend.');
    } finally {
      setLoading(false);
    }
  }

  // ── Join blend ───────────────────────────────────────────────────────
  async function handleJoin() {
    if (!inviteToken.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await blendApi.join(inviteToken.trim());
      // After joining, view the blend
      await handleViewBlend(data.blendId);
    } catch (err) {
      setError(err.message || 'Could not join blend.');
      setLoading(false);
    }
  }

  // ── View blend detail ────────────────────────────────────────────────
  async function handleViewBlend(blendId) {
    setLoading(true);
    setError(null);
    try {
      const data = await blendApi.get(blendId);
      setBlendDetail(data);
      setView('detail');
    } catch (err) {
      setError(err.message || 'Could not load blend.');
    } finally {
      setLoading(false);
    }
  }

  // ── Copy invite link ─────────────────────────────────────────────────
  function copyInviteLink() {
    if (!inviteData) return;
    const url = `${window.location.origin}${window.location.pathname}?blend=${inviteData.inviteToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  }

  // ── Not logged in ────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="space-y-6 mt-4">
        <EmptyNotLoggedIn onShowAuth={onShowAuth} />
        {inviteToken && (
          <div className="glass-panel p-6 text-center space-y-3 border border-violet-500/20">
            <Link2 className="w-8 h-8 text-violet-400 mx-auto" />
            <p className="text-sm text-slate-300">
              You have a blend invitation. Sign in to accept it.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── Loading ──────────────────────────────────────────────────────────
  if (loading && view !== 'detail' && view !== 'list') {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-4">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="glass-panel p-6 bg-gradient-to-r from-violet-950/40 via-slate-900/60 to-pink-950/40 border border-violet-500/20">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-violet-400 mb-2">
          <Users className="w-4 h-4" />
          Friend Blend
        </div>
        <h1 className="text-2xl lg:text-3xl font-extrabold text-white font-heading">
          Blend with a Friend
        </h1>
        <p className="text-sm text-slate-300 max-w-3xl mt-1">
          Compare your music taste with a friend. See your compatibility score, shared traits,
          biggest differences, and get track recommendations for both of you.
        </p>
      </div>

      {/* ── Error banner ────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-950/30 border border-red-500/30 rounded-xl text-sm text-red-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-xs text-red-400 hover:text-red-200">Dismiss</button>
        </div>
      )}

      {/* ── VIEW: List ──────────────────────────────────────────────── */}
      {view === 'list' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <button type="button" onClick={handleCreate} disabled={loading}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-violet-600 hover:bg-violet-500 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50 shadow-lg shadow-violet-500/20">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              Create New Blend
            </button>
            <button type="button" onClick={() => setView('join')}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm font-semibold text-slate-200 transition-colors">
              <Link2 className="w-4 h-4" />
              Join with Invite
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
            </div>
          ) : blends.length === 0 ? (
            <div className="glass-panel p-10 text-center space-y-3">
              <Music2 className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="text-sm text-slate-400">No blends yet. Create one and share the invite with a friend!</p>
            </div>
          ) : (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-300">Your Blends</h3>
              {blends.map((b) => (
                <BlendCard key={b.blendId} blend={b} onView={handleViewBlend} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── VIEW: Invite (after creating) ───────────────────────────── */}
      {view === 'invite' && inviteData && (
        <div className="glass-panel p-8 space-y-5 border border-violet-500/20 max-w-lg mx-auto text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-violet-600 to-pink-500 flex items-center justify-center mx-auto shadow-lg shadow-violet-500/30">
            <Link2 className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white">Blend Created!</h2>
          <p className="text-sm text-slate-300">Share this link with your friend so they can join the blend.</p>

          <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 flex items-center gap-2">
            <input type="text" readOnly
              value={`${window.location.origin}${window.location.pathname}?blend=${inviteData.inviteToken}`}
              className="flex-1 bg-transparent text-xs text-slate-300 font-mono outline-none min-w-0"
            />
            <button type="button" onClick={copyInviteLink}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-semibold text-white transition-colors flex-shrink-0">
              {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <p className="text-[11px] text-slate-500">
            This invite expires {new Date(inviteData.expiresAt).toLocaleDateString()}.
            Your friend needs a MusicLens account to join.
          </p>

          <div className="flex gap-2 justify-center pt-2">
            <button type="button" onClick={() => { setView('list'); loadBlends(); }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-semibold text-slate-300 transition-colors">
              ← Back to Blends
            </button>
            <button type="button" onClick={() => handleViewBlend(inviteData.blendId)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white transition-colors">
              View Blend
            </button>
          </div>
        </div>
      )}

      {/* ── VIEW: Join ──────────────────────────────────────────────── */}
      {view === 'join' && (
        <div className="glass-panel p-8 space-y-5 border border-violet-500/20 max-w-lg mx-auto text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-violet-500 flex items-center justify-center mx-auto shadow-lg shadow-blue-500/30">
            <ArrowRight className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white">Join a Blend</h2>
          <p className="text-sm text-slate-300">Paste the invite link or token your friend shared with you.</p>

          <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 flex items-center gap-2">
            <input type="text" placeholder="Paste invite link or token..."
              value={inviteToken}
              onChange={(e) => {
                // Extract token from full URL or accept raw token
                const v = e.target.value.trim();
                const match = v.match(/[?&]blend=([a-f0-9]{64})/i);
                setInviteToken(match ? match[1] : v);
              }}
              className="flex-1 bg-transparent text-xs text-slate-300 font-mono outline-none min-w-0 placeholder-slate-600"
            />
          </div>

          <div className="flex gap-2 justify-center">
            <button type="button" onClick={() => { setView('list'); setInviteToken(''); }}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-semibold text-slate-300 transition-colors">
              ← Back
            </button>
            <button type="button" onClick={handleJoin} disabled={!inviteToken.trim() || loading}
              className="flex items-center gap-2 px-5 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              Join Blend
            </button>
          </div>
        </div>
      )}

      {/* ── VIEW: Blend detail ──────────────────────────────────────── */}
      {view === 'detail' && (
        <div className="space-y-4">
          <button type="button" onClick={() => { setView('list'); setBlendDetail(null); loadBlends(); }}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors">
            ← Back to all blends
          </button>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center space-y-3">
                <Loader2 className="w-8 h-8 text-violet-400 animate-spin mx-auto" />
                <p className="text-xs text-slate-400">Calculating your blend…</p>
              </div>
            </div>
          ) : !blendDetail ? (
            <div className="glass-panel p-8 text-center text-slate-400">Blend not found.</div>
          ) : blendDetail.status === 'pending' ? (
            <div className="glass-panel p-10 text-center space-y-4 border border-amber-500/20">
              <Loader2 className="w-10 h-10 text-amber-400 mx-auto animate-pulse" />
              <h3 className="text-lg font-bold text-white">Waiting for your friend to join</h3>
              <p className="text-sm text-slate-400 max-w-md mx-auto">
                Share the invite link with your friend. Once they accept, your blend will be calculated.
              </p>
              {blendDetail.inviteToken && (
                <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 flex items-center gap-2 max-w-md mx-auto">
                  <input type="text" readOnly
                    value={`${window.location.origin}${window.location.pathname}?blend=${blendDetail.inviteToken}`}
                    className="flex-1 bg-transparent text-xs text-slate-300 font-mono outline-none min-w-0"
                  />
                  <button type="button" onClick={() => {
                    const url = `${window.location.origin}${window.location.pathname}?blend=${blendDetail.inviteToken}`;
                    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 3000); });
                  }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs font-semibold text-white transition-colors flex-shrink-0">
                    {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              )}
            </div>
          ) : blendDetail.status === 'expired' ? (
            <div className="glass-panel p-8 text-center space-y-3 border border-slate-700">
              <AlertCircle className="w-8 h-8 text-slate-500 mx-auto" />
              <h3 className="text-lg font-bold text-slate-300">Blend Expired</h3>
              <p className="text-sm text-slate-500">This blend invitation has expired. Create a new one.</p>
            </div>
          ) : blendDetail.profilesReady && (!blendDetail.profilesReady.creator || !blendDetail.profilesReady.participant) ? (
            <div className="glass-panel p-10 text-center space-y-4 border border-blue-500/20">
              <UserCircle2 className="w-10 h-10 text-blue-400 mx-auto" />
              <h3 className="text-lg font-bold text-white">Profiles Needed</h3>
              <p className="text-sm text-slate-400 max-w-md mx-auto">
                {blendDetail.message || 'Both users need a MusicLens profile before we can calculate your Blend.'}
              </p>
              <div className="flex gap-3 justify-center text-xs">
                <span className={`px-3 py-1.5 rounded-lg border ${
                  blendDetail.profilesReady.creator ? 'bg-emerald-950 border-emerald-800 text-emerald-400' : 'bg-red-950 border-red-800 text-red-400'
                }`}>
                  {blendDetail.creatorEmail}: {blendDetail.profilesReady.creator ? '✓ Ready' : '✗ No profile'}
                </span>
                <span className={`px-3 py-1.5 rounded-lg border ${
                  blendDetail.profilesReady.participant ? 'bg-emerald-950 border-emerald-800 text-emerald-400' : 'bg-red-950 border-red-800 text-red-400'
                }`}>
                  {blendDetail.participantEmail}: {blendDetail.profilesReady.participant ? '✓ Ready' : '✗ No profile'}
                </span>
              </div>
              <button type="button" onClick={() => handleViewBlend(blendDetail.blendId)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white transition-colors flex items-center gap-1.5 mx-auto">
                <RefreshCw className="w-3.5 h-3.5" /> Recheck
              </button>
            </div>
          ) : blendDetail.result ? (
            <BlendResult
              result={blendDetail.result}
              creatorEmail={blendDetail.creatorEmail}
              participantEmail={blendDetail.participantEmail}
            />
          ) : (
            <div className="glass-panel p-8 text-center text-slate-400">
              <Loader2 className="w-6 h-6 text-violet-400 animate-spin mx-auto mb-3" />
              <p className="text-sm">Calculating your blend…</p>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
