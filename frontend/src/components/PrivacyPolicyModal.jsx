/**
 * frontend/src/components/PrivacyPolicyModal.jsx
 * Shown before the user is redirected to Spotify for authorization.
 * The user must explicitly check the acknowledgment checkbox before
 * the "Continue to Spotify" button becomes active.
 *
 * Requirement 12.7 / 13.3: explicit checkbox acknowledgment required.
 * Requirement 13.4: dismissal without checking does NOT navigate to /api/spotify/connect.
 */

import React, { useState } from 'react';
import { X, ShieldCheck, ExternalLink } from 'lucide-react';
import { spotifyApi } from '../utils/apiClient';

export default function PrivacyPolicyModal({ onClose }) {
  const [acknowledged, setAcknowledged] = useState(false);

  function handleContinue() {
    if (!acknowledged) return;
    // Navigate the full browser window — triggers the server-side redirect to Spotify.
    // Tokens never reach React state.
    window.location.href = spotifyApi.connectUrl;
  }

  return (
    /* Backdrop */
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="glass-panel w-full max-w-lg space-y-5 p-7 relative">

        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 id="privacy-modal-title" className="text-lg font-bold text-white font-heading">
              Before you connect Spotify
            </h2>
            <p className="text-xs text-slate-400">Please read how MusicLens uses your data.</p>
          </div>
        </div>

        {/* Policy content */}
        <div className="space-y-4 text-sm text-slate-300">
          <section className="space-y-1.5">
            <h3 className="font-semibold text-white text-xs uppercase tracking-wide">What we access</h3>
            <ul className="space-y-1 text-slate-400 text-xs list-disc list-inside">
              <li><span className="text-slate-200">Account identity</span> — your Spotify display name and account ID (for linking only)</li>
              <li><span className="text-slate-200">Top tracks</span> — your most-listened tracks to seed recommendations</li>
              <li><span className="text-slate-200">Recently played</span> — recent listening to match against our 30K catalog</li>
              <li><span className="text-slate-200">Saved tracks</span> — liked songs for richer taste matching</li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h3 className="font-semibold text-white text-xs uppercase tracking-wide">How tokens are stored</h3>
            <p className="text-xs text-slate-400">
              Your Spotify access and refresh tokens are encrypted with AES-256-GCM before being stored.
              They live <span className="text-white">exclusively on our server</span> and are never sent to your browser or logged.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="font-semibold text-white text-xs uppercase tracking-wide">Revoking access</h3>
            <p className="text-xs text-slate-400">
              You can disconnect Spotify at any time from your account panel.
              Disconnecting <span className="text-white">immediately deletes all stored tokens and Spotify-derived data</span> from our database.
              You can also revoke access from your{' '}
              <a
                href="https://www.spotify.com/account/apps/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline inline-flex items-center gap-0.5"
              >
                Spotify account settings <ExternalLink className="w-3 h-3" />
              </a>.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="font-semibold text-white text-xs uppercase tracking-wide">What we don't do</h3>
            <ul className="text-xs text-slate-400 list-disc list-inside space-y-1">
              <li>We do not play or redistribute Spotify audio content.</li>
              <li>We do not train AI models using your Spotify data.</li>
              <li>We do not sell your data to third parties.</li>
            </ul>
          </section>

          <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 text-xs text-slate-400">
            <span className="text-slate-200 font-medium">Development mode notice: </span>
            MusicLens uses Spotify in development mode. Only pre-approved accounts can connect.
            Contact the developer to be added to the allowlist.
          </div>
        </div>

        {/* Acknowledgment checkbox */}
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded accent-blue-500 cursor-pointer flex-shrink-0"
          />
          <span className="text-sm text-slate-300 group-hover:text-slate-200 transition-colors select-none">
            I understand how MusicLens accesses and stores my Spotify data, and I agree to connect my account.
          </span>
        </label>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-lg border border-slate-700 text-slate-300 hover:text-white hover:border-slate-600 text-sm font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={!acknowledged}
            className="flex-1 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shadow-md shadow-emerald-500/20"
          >
            Continue to Spotify
          </button>
        </div>
      </div>
    </div>
  );
}
