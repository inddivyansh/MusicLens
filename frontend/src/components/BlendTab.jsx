import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Loader2,
  AlertCircle,
  RefreshCw,
  Copy,
  CheckCircle2,
  Users,
  Music2,
  BarChart2,
  UserCircle2,
  Heart,
  ArrowRight,
  Link2,
  Waves,
  Mic2,
  TrendingDown,
  Info,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { blendApi, ApiError } from '../utils/apiClient';
import SectionHeader from './ui/SectionHeader';
import StatBar from './ui/StatBar';
import Pill from './ui/Pill';
import EmptyState from './ui/EmptyState';

function fmt(n, dec = 1) {
  return n != null && !isNaN(n) ? Number(n).toFixed(dec) : '—';
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

function scoreColor(score) {
  if (score >= 85) return 'text-purple-300';
  if (score >= 70) return 'text-indigo-300';
  if (score >= 50) return 'text-amber-300';
  return 'text-rose-300';
}

function scoreLabel(score) {
  if (score >= 90) return 'Sonic Soulmates 🎶';
  if (score >= 80) return 'Music Twins ✨';
  if (score >= 70) return 'Great Harmony 🤝';
  if (score >= 60) return 'Good Resonance 🎵';
  if (score >= 50) return 'Interesting Blend 🎧';
  return 'Eclectic Opposites 🔀';
}

function BlendResult({ result, creatorEmail, participantEmail }) {
  const {
    blendScore,
    vectorSimilarity,
    featureCompatibility,
    genreAnalysis,
    sharedTraits,
    biggestDifferences,
    sharedArtists,
    sharedRecommendations,
  } = result;

  return (
    <div className="space-y-6">
      {/* Blend Score Hero */}
      <div className="glass-panel p-8 sm:p-10 border-purple-500/30 bg-gradient-to-br from-[#1e1533] via-[#140e24] to-[#0b0713] text-center space-y-3 relative overflow-hidden shadow-2xl shadow-purple-950/40">
        <div className="pointer-events-none absolute -right-16 -top-16 w-64 h-64 rounded-full bg-purple-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -left-16 -bottom-16 w-64 h-64 rounded-full bg-indigo-600/20 blur-3xl" />

        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-xs font-bold uppercase tracking-wider text-purple-400 mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            Compatibility Score
          </div>
          <div className={`text-6xl sm:text-7xl font-extrabold font-heading ${scoreColor(blendScore)} tracking-tight`}>
            {fmt(blendScore, 0)}%
          </div>
          <p className="text-xl font-bold text-white font-heading">{scoreLabel(blendScore)}</p>
          <p className="text-xs text-[#a1a1c2]">
            Vector match: {fmt(vectorSimilarity)}% • Genre similarity: {fmt(genreAnalysis.similarity)}%
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-[#6b6b8f] pt-2">
            <span className="px-3 py-1 bg-[#1e1533] border border-white/10 rounded-xl text-white font-medium">
              {creatorEmail.split('@')[0]}
            </span>
            <span>×</span>
            <span className="px-3 py-1 bg-[#1e1533] border border-white/10 rounded-xl text-white font-medium">
              {participantEmail.split('@')[0]}
            </span>
          </div>
        </div>
      </div>

      {/* Shared Traits & Differences */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-pink-400" />
            <h3 className="text-base font-bold text-white font-heading">You Both Love</h3>
          </div>
          <div className="space-y-3">
            {sharedTraits.map((t) => (
              <StatBar
                key={t.feature}
                label={t.feature}
                value={t.compatibility}
                displayValue={`${fmt(t.compatibility)}%`}
                colorClass="bg-pink-500"
                sub={t.label}
              />
            ))}
          </div>
        </div>

        <div className="glass-panel p-6 space-y-4">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-amber-400" />
            <h3 className="text-base font-bold text-white font-heading">Biggest Contrasts</h3>
          </div>
          <div className="space-y-3">
            {biggestDifferences.map((d) => (
              <StatBar
                key={d.feature}
                label={d.feature}
                value={d.compatibility}
                displayValue={`${fmt(d.compatibility)}%`}
                colorClass="bg-amber-500"
                sub={d.label}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Detailed Feature Compatibility */}
      <div className="glass-panel p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Waves className="w-4 h-4 text-purple-400" />
          <h3 className="text-base font-bold text-white font-heading">Feature Alignment</h3>
        </div>
        <div className="space-y-3">
          {featureCompatibility.map((f) => (
            <div key={f.feature} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-white capitalize">{f.feature}</span>
                <span className="font-mono font-bold text-purple-300">{fmt(f.compatibility)}%</span>
              </div>
              <div className="progress-bar-bg">
                <div
                  className="progress-bar-fill bg-purple-500"
                  style={{ width: `${Math.min(100, f.compatibility)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-[#6b6b8f]">
                <span>{creatorEmail.split('@')[0]}: {fmt(f.userA, 2)}</span>
                <span>{participantEmail.split('@')[0]}: {fmt(f.userB, 2)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Shared Genres */}
      {genreAnalysis.shared.length > 0 && (
        <div className="glass-panel p-6 space-y-4">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-amber-400" />
            <h3 className="text-base font-bold text-white font-heading">Shared Sound Profiles</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {genreAnalysis.shared.map(({ genre, pctA, pctB }) => (
              <Pill
                key={genre}
                label={`${genre} (${fmt(pctA, 0)}% / ${fmt(pctB, 0)}%)`}
                genre={genre}
                size="md"
              />
            ))}
          </div>
        </div>
      )}

      {/* Shared Artists */}
      {sharedArtists.length > 0 && (
        <div className="glass-panel p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Mic2 className="w-4 h-4 text-purple-400" />
            <h3 className="text-base font-bold text-white font-heading">Artists You Both Enjoy</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {sharedArtists.map((a) => (
              <span
                key={a}
                className="px-3 py-1.5 bg-[#1e1533] border border-white/10 rounded-xl text-xs text-white font-medium"
              >
                {a}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Shared Recommendations */}
      {sharedRecommendations.length > 0 && (
        <div className="glass-panel p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-purple-400" />
            <h3 className="text-base font-bold text-white font-heading">Recommended for Both of You</h3>
          </div>
          <div className="space-y-3">
            {sharedRecommendations.map((rec) => {
              const primaryGenre = (rec.genre_name || '').split(', ')[0];
              return (
                <div
                  key={rec.track_id}
                  className="glass-card-interactive p-4 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 truncate">
                    <span className="text-xs font-mono font-bold text-[#6b6b8f] w-5">#{rec.rank}</span>
                    <div className="truncate">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-white truncate">{rec.track_name}</span>
                        {primaryGenre && <Pill label={primaryGenre} genre={primaryGenre} size="sm" />}
                      </div>
                      <span className="text-[11px] text-[#a1a1c2]">by {rec.artist_name}</span>
                    </div>
                  </div>
                  <span className="font-bold text-xs text-purple-300 font-mono shrink-0">
                    {rec.similarity_pct}% match
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BlendCard({ blend, onView }) {
  const statusBadge = {
    pending: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    accepted: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
    completed: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
    expired: 'bg-white/5 text-[#6b6b8f] border-white/5',
  };

  return (
    <div className="glass-card-interactive p-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 shrink-0">
          <Users className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white truncate">
            Blend with {blend.partnerEmail || '(waiting for friend)'}
          </p>
          <p className="text-[10px] text-[#6b6b8f]">
            {blend.role === 'creator' ? 'Created' : 'Joined'} {timeAgo(blend.createdAt)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-[10px] px-2 py-0.5 rounded-full border capitalize font-bold ${statusBadge[blend.status] || statusBadge.expired}`}>
          {blend.status}
        </span>
        {(blend.status === 'completed' || blend.status === 'accepted') && (
          <button
            type="button"
            onClick={() => onView(blend.blendId)}
            className="px-3 py-1 bg-signature-gradient hover:opacity-95 rounded-lg text-xs font-semibold text-white transition-all shadow-sm"
          >
            View
          </button>
        )}
      </div>
    </div>
  );
}

export default function BlendTab({ onShowAuth, initialInviteToken }) {
  const { user } = useAuth();

  const [view, setView] = useState('list');
  const [blends, setBlends] = useState([]);
  const [blendDetail, setBlendDetail] = useState(null);
  const [inviteData, setInviteData] = useState(null);
  const [inviteToken, setInviteToken] = useState(initialInviteToken || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    if (initialInviteToken && user) {
      setInviteToken(initialInviteToken);
      setView('join');
    } else if (initialInviteToken && !user) {
      setInviteToken(initialInviteToken);
    }
  }, [initialInviteToken, user]);

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

  async function handleJoin() {
    if (!inviteToken.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await blendApi.join(inviteToken.trim());
      await handleViewBlend(data.blendId);
    } catch (err) {
      setError(err.message || 'Could not join blend.');
      setLoading(false);
    }
  }

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

  function copyInviteLink() {
    if (!inviteData) return;
    const url = `${window.location.origin}${window.location.pathname}?blend=${inviteData.inviteToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    });
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <SectionHeader
          eyebrow="Social Discovery"
          title="Blend with a Friend"
          description="Compare your music taste with a friend. See your compatibility score, shared traits, and recommended tracks."
        />
        <EmptyState
          icon={Users}
          title="Sign in to Blend"
          message="Compare your music taste with a friend. Both users need a free MusicLens account to generate a Blend."
          actionText="Sign in / Register"
          onAction={onShowAuth}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <SectionHeader
        eyebrow="Social Discovery"
        title="Friend Blend"
        description="Compare your taste profile with friends to discover shared favorites, contrasting traits, and mutual recommendations."
        badge={
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-purple-500/10 text-purple-300 border border-purple-500/20">
            Beta
          </span>
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

      {/* VIEW: List */}
      {view === 'list' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleCreate}
              disabled={loading}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-signature-gradient hover:opacity-95 rounded-xl text-xs font-semibold text-white transition-all shadow-md shadow-purple-600/25 active:scale-95 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              <span>Create New Blend</span>
            </button>
            <button
              type="button"
              onClick={() => setView('join')}
              className="flex items-center justify-center gap-2 px-5 py-3 bg-[#1e1533] hover:bg-[#2a1f45] border border-white/10 rounded-xl text-xs font-semibold text-white transition-colors"
            >
              <Link2 className="w-4 h-4" />
              <span>Join with Invite</span>
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
            </div>
          ) : blends.length === 0 ? (
            <EmptyState
              icon={Music2}
              title="No Blends Created Yet"
              message="Create a Blend and share the invite link with a friend to compare your music tastes!"
            />
          ) : (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#a1a1c2] px-1">Your Blends</h3>
              {blends.map((b) => (
                <BlendCard key={b.blendId} blend={b} onView={handleViewBlend} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW: Invite */}
      {view === 'invite' && inviteData && (
        <div className="glass-panel p-8 space-y-5 border-purple-500/20 max-w-lg mx-auto text-center">
          <div className="w-14 h-14 rounded-2xl bg-signature-gradient flex items-center justify-center mx-auto shadow-lg shadow-purple-600/30 text-white">
            <Link2 className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white font-heading">Blend Created!</h2>
            <p className="text-xs text-[#a1a1c2]">Share this link with your friend so they can join the blend.</p>
          </div>

          <div className="bg-[#140e24] border border-white/10 rounded-xl p-2.5 flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={`${window.location.origin}${window.location.pathname}?blend=${inviteData.inviteToken}`}
              className="flex-1 bg-transparent text-xs text-[#a1a1c2] font-mono outline-none min-w-0 px-1"
            />
            <button
              type="button"
              onClick={copyInviteLink}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-signature-gradient hover:opacity-95 rounded-lg text-xs font-semibold text-white transition-all shrink-0"
            >
              {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>

          <div className="flex gap-2 justify-center pt-2">
            <button
              type="button"
              onClick={() => {
                setView('list');
                loadBlends();
              }}
              className="px-4 py-2 bg-[#1e1533] hover:bg-[#2a1f45] border border-white/10 rounded-xl text-xs font-semibold text-white transition-colors"
            >
              ← Back to Blends
            </button>
            <button
              type="button"
              onClick={() => handleViewBlend(inviteData.blendId)}
              className="px-4 py-2 bg-signature-gradient hover:opacity-95 rounded-xl text-xs font-semibold text-white transition-all"
            >
              View Blend
            </button>
          </div>
        </div>
      )}

      {/* VIEW: Join */}
      {view === 'join' && (
        <div className="glass-panel p-8 space-y-5 border-purple-500/20 max-w-lg mx-auto text-center">
          <div className="w-14 h-14 rounded-2xl bg-signature-gradient flex items-center justify-center mx-auto shadow-lg shadow-purple-600/30 text-white">
            <ArrowRight className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-white font-heading">Join a Blend</h2>
            <p className="text-xs text-[#a1a1c2]">Paste the invite link or token your friend shared with you.</p>
          </div>

          <div className="bg-[#140e24] border border-white/10 rounded-xl p-2.5">
            <input
              type="text"
              placeholder="Paste invite link or token..."
              value={inviteToken}
              onChange={(e) => {
                const v = e.target.value.trim();
                const match = v.match(/[?&]blend=([a-f0-9]{64})/i);
                setInviteToken(match ? match[1] : v);
              }}
              className="w-full bg-transparent text-xs text-white font-mono outline-none placeholder-[#6b6b8f]"
            />
          </div>

          <div className="flex gap-2 justify-center">
            <button
              type="button"
              onClick={() => {
                setView('list');
                setInviteToken('');
              }}
              className="px-4 py-2 bg-[#1e1533] hover:bg-[#2a1f45] border border-white/10 rounded-xl text-xs font-semibold text-white transition-colors"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={handleJoin}
              disabled={!inviteToken.trim() || loading}
              className="flex items-center gap-2 px-5 py-2 bg-signature-gradient hover:opacity-95 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-50 shadow-md shadow-purple-600/20"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Users className="w-3.5 h-3.5" />}
              <span>Join Blend</span>
            </button>
          </div>
        </div>
      )}

      {/* VIEW: Detail */}
      {view === 'detail' && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setView('list');
              setBlendDetail(null);
              loadBlends();
            }}
            className="text-xs font-semibold text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
          >
            ← Back to all blends
          </button>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center space-y-3">
                <Loader2 className="w-8 h-8 text-purple-400 animate-spin mx-auto" />
                <p className="text-xs text-[#a1a1c2]">Calculating your blend…</p>
              </div>
            </div>
          ) : !blendDetail ? (
            <div className="glass-panel p-8 text-center text-[#a1a1c2]">Blend not found.</div>
          ) : blendDetail.result ? (
            <BlendResult
              result={blendDetail.result}
              creatorEmail={blendDetail.creatorEmail}
              participantEmail={blendDetail.participantEmail}
            />
          ) : blendDetail.status === 'pending' ? (
            <EmptyState
              icon={Users}
              title="Waiting for your friend to join"
              message="Share the invite link with your friend. Once they accept, your blend will be calculated."
            />
          ) : (
            <EmptyState
              icon={AlertCircle}
              title="Profiles Needed"
              message={blendDetail.message || 'Both users need a completed profile before calculating the Blend.'}
            />
          )}
        </div>
      )}
    </div>
  );
}
