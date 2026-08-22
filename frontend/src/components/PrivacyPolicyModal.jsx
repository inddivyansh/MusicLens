import React, { useState } from 'react';
import { X, ShieldCheck, ExternalLink } from 'lucide-react';
import { spotifyApi } from '../utils/apiClient';

export default function PrivacyPolicyModal({ onClose }) {
  const [acknowledged, setAcknowledged] = useState(false);

  function handleContinue() {
    if (!acknowledged) return;
    window.location.href = spotifyApi.connectUrl;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="glass-panel w-full max-w-lg space-y-5 p-6 sm:p-7 relative border-purple-500/20 shadow-2xl shadow-purple-950/50">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-xl text-[#a1a1c2] hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 id="privacy-modal-title" className="text-lg font-bold text-white font-heading">
              Connecting Your Spotify
            </h2>
            <p className="text-xs text-[#a1a1c2]">How MusicLens handles your listening data.</p>
          </div>
        </div>

        {/* Policy Content */}
        <div className="space-y-3.5 text-xs text-[#a1a1c2] max-h-[60vh] overflow-y-auto pr-1">
          <section className="space-y-1">
            <h3 className="font-bold text-white text-[11px] uppercase tracking-wider">What We Access</h3>
            <ul className="space-y-1 list-disc list-inside text-[#a1a1c2]">
              <li><span className="text-white font-medium">Account Profile</span> — Display name and avatar for account linking</li>
              <li><span className="text-white font-medium">Top Tracks</span> — Most-played songs to generate your taste profile</li>
              <li><span className="text-white font-medium">Recently Played</span> — Recent listening to compute recommendations</li>
              <li><span className="text-white font-medium">Saved Tracks</span> — Liked music for deeper personal matching</li>
            </ul>
          </section>

          <section className="space-y-1">
            <h3 className="font-bold text-white text-[11px] uppercase tracking-wider">Security &amp; Encryption</h3>
            <p className="leading-relaxed">
              Spotify tokens are securely encrypted using standard AES-256-GCM algorithms.
              Tokens are stored securely on our backend server and are never exposed to client-side scripts.
            </p>
          </section>

          <section className="space-y-1">
            <h3 className="font-bold text-white text-[11px] uppercase tracking-wider">Revoking Access</h3>
            <p className="leading-relaxed">
              You can disconnect Spotify at any time. Disconnecting removes your connection tokens and stored taste metrics. You can also manage access via your{' '}
              <a
                href="https://www.spotify.com/account/apps/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-300 hover:underline inline-flex items-center gap-0.5"
              >
                Spotify Account Settings <ExternalLink className="w-3 h-3" />
              </a>.
            </p>
          </section>

          <div className="bg-[#140e24] border border-white/5 rounded-xl p-3 text-[11px] text-[#a1a1c2]">
            <span className="text-purple-300 font-semibold">Development Notice: </span>
            MusicLens uses Spotify APIs in development mode. Only allowlisted Spotify accounts can connect.
          </div>
        </div>

        {/* Acknowledgment Checkbox */}
        <label className="flex items-start gap-3 cursor-pointer group pt-1">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded accent-purple-500 cursor-pointer shrink-0"
          />
          <span className="text-xs text-[#a1a1c2] group-hover:text-white transition-colors select-none leading-normal">
            I understand how MusicLens analyzes my Spotify listening data, and I agree to connect my account.
          </span>
        </label>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-xl border border-white/10 text-[#a1a1c2] hover:text-white hover:bg-white/5 text-xs font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={!acknowledged}
            className="flex-1 py-2.5 px-4 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold text-xs transition-all shadow-md shadow-[#1DB954]/20"
          >
            Continue to Spotify
          </button>
        </div>
      </div>
    </div>
  );
}
