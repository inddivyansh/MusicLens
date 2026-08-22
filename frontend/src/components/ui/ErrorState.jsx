import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

/**
 * ErrorState — Calm generic error state without technical database jargon.
 *
 * @param {string} [title="We couldn't load your insights right now"]
 * @param {string} [message="Please check your connection and try again."]
 * @param {Function} [onRetry]
 */
export default function ErrorState({
  title = "We couldn't load your insights right now",
  message = "Please try again in a moment.",
  onRetry,
}) {
  return (
    <div className="glass-panel p-8 sm:p-12 text-center space-y-4 my-8 max-w-lg mx-auto border-red-500/20 bg-red-950/10">
      <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-400">
        <AlertCircle className="w-6 h-6" />
      </div>

      <div className="space-y-1">
        <h3 className="text-base font-bold text-white font-heading">{title}</h3>
        <p className="text-xs text-[#a1a1c2] leading-relaxed max-w-sm mx-auto">
          {message}
        </p>
      </div>

      {onRetry && (
        <div className="pt-2">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#1e1533] hover:bg-[#2a1f45] text-xs font-semibold rounded-xl text-white transition-colors border border-purple-500/30"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Try again
          </button>
        </div>
      )}
    </div>
  );
}
