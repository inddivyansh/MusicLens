import React from 'react';
import { Headphones } from 'lucide-react';

/**
 * EmptyState — Standardized placeholder and onboarding visual.
 *
 * @param {React.ComponentType} [icon]
 * @param {string} title
 * @param {string} message
 * @param {string} [actionText]
 * @param {Function} [onAction]
 * @param {string} [secondaryText]
 */
export default function EmptyState({
  icon: Icon = Headphones,
  title,
  message,
  actionText,
  onAction,
  secondaryText,
}) {
  return (
    <div className="glass-panel p-8 sm:p-12 text-center space-y-4 my-6 max-w-xl mx-auto border-purple-500/20 shadow-xl shadow-purple-950/20">
      <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto text-purple-400">
        <Icon className="w-7 h-7" />
      </div>

      <div className="space-y-1.5">
        <h3 className="text-lg font-bold text-white font-heading">{title}</h3>
        <p className="text-sm text-[#a1a1c2] max-w-md mx-auto leading-relaxed">
          {message}
        </p>
      </div>

      {actionText && onAction && (
        <div className="pt-2">
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-signature-gradient hover:opacity-95 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-purple-600/25 active:scale-95"
          >
            {actionText}
          </button>
        </div>
      )}

      {secondaryText && (
        <p className="text-xs text-[#6b6b8f] pt-1">{secondaryText}</p>
      )}
    </div>
  );
}
