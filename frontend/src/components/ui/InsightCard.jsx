import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

/**
 * InsightCard — Plain-language finding card with optional expandable statistical details.
 *
 * @param {string} title - Feature/dimension name
 * @param {string} takeaway - Human-readable conclusion (e.g., 'Rap and Latin show highest danceability')
 * @param {string} leader - Top genres or artists in this dimension
 * @param {object} [mathDetails] - Optional statistical breakdown { anovaF, pVal, etaSq, effect }
 */
export default function InsightCard({ title, takeaway, leader, mathDetails }) {
  const [showStats, setShowStats] = useState(false);

  return (
    <div className="glass-card-interactive p-4 sm:p-5 flex flex-col justify-between space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white font-heading tracking-wide">
            {title}
          </h3>
          {mathDetails?.effect && (
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
              {mathDetails.effect} Effect
            </span>
          )}
        </div>
        <p className="text-xs text-[#a1a1c2] leading-relaxed">
          {takeaway}
        </p>
      </div>

      {leader && (
        <div className="text-xs text-purple-300 font-medium bg-purple-950/30 border border-purple-500/20 rounded-lg p-2.5">
          <span className="text-[#a1a1c2] block text-[10px] uppercase tracking-wider mb-0.5">Top genres in this dimension</span>
          {leader}
        </div>
      )}

      {mathDetails && (
        <div className="pt-2 border-t border-white/5">
          <button
            type="button"
            onClick={() => setShowStats(!showStats)}
            className="text-[11px] font-semibold text-purple-400 hover:text-purple-300 flex items-center gap-1 transition-colors"
          >
            <span>{showStats ? 'Hide details' : 'Show statistical details'}</span>
            {showStats ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {showStats && (
            <div className="mt-2 grid grid-cols-3 gap-2 bg-[#140e24] p-2.5 rounded-lg border border-white/5 font-mono text-[10px]">
              <div>
                <span className="text-[#6b6b8f] block">F-Stat</span>
                <span className="text-white font-bold">{mathDetails.anovaF}</span>
              </div>
              <div>
                <span className="text-[#6b6b8f] block">p-Value</span>
                <span className="text-emerald-400 font-bold">{mathDetails.pVal}</span>
              </div>
              <div>
                <span className="text-[#6b6b8f] block">Eta Squared (η²)</span>
                <span className="text-purple-300 font-bold">{mathDetails.etaSq}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
