import React from 'react';

/**
 * KpiStat — Standardized stat card.
 *
 * @param {string} label - Metric label
 * @param {string|number} value - Formatted value
 * @param {string} [sub] - Optional footer note or subtitle
 * @param {React.ComponentType} [icon] - Optional lucide icon
 * @param {string} [accent] - 'purple' | 'indigo' | 'amber' | 'emerald' | 'cyan'
 * @param {boolean} [highlight] - If true, adds a signature gradient border
 */
export default function KpiStat({ label, value, sub, icon: Icon, accent = 'purple', highlight = false }) {
  const accentIconColors = {
    purple:  'text-purple-400 bg-purple-500/10 border-purple-500/20',
    indigo:  'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    amber:   'text-amber-400  bg-amber-500/10  border-amber-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    cyan:    'text-cyan-400   bg-cyan-500/10   border-cyan-500/20',
  };

  const iconClass = accentIconColors[accent] || accentIconColors.purple;

  return (
    <div
      className={`glass-card-interactive p-4 sm:p-5 flex flex-col justify-between relative overflow-hidden ${
        highlight
          ? 'border-purple-500/40 shadow-lg shadow-purple-950/30 bg-gradient-to-b from-[#1e1533] to-[#140e24]'
          : 'border-white/5'
      }`}
    >
      {highlight && (
        <div className="pointer-events-none absolute -top-10 -right-10 w-24 h-24 rounded-full bg-purple-500/20 blur-xl" />
      )}

      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#a1a1c2]">
          {label}
        </span>
        {Icon && (
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${iconClass}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
        )}
      </div>

      <div className="text-2xl sm:text-3xl font-extrabold text-white font-heading tracking-tight my-1">
        {value ?? '—'}
      </div>

      {sub && (
        <div className="text-xs text-[#6b6b8f] mt-1 truncate">
          {sub}
        </div>
      )}
    </div>
  );
}
