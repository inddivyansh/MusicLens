import React from 'react';

/**
 * SectionHeader — Unified top hero banner for every tab.
 *
 * @param {string} eyebrow - Small uppercase context tag
 * @param {string} title - Prominent heading
 * @param {string} description - 1-2 sentence friendly explanation
 * @param {React.ReactNode} [badge] - Optional badge or tag
 * @param {React.ReactNode} [actions] - Action buttons slot on the right
 */
export default function SectionHeader({ eyebrow, title, description, badge, actions }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-purple-500/20 bg-gradient-to-r from-[#1e1533] via-[#140e24] to-[#0b0713] p-6 lg:p-8 shadow-xl shadow-purple-950/20">
      {/* Subtle background glow */}
      <div className="pointer-events-none absolute -right-12 -top-12 h-64 w-64 rounded-full bg-purple-600/10 blur-3xl" />
      <div className="pointer-events-none absolute -left-12 -bottom-12 h-48 w-48 rounded-full bg-indigo-600/10 blur-2xl" />

      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1.5 max-w-3xl">
          {eyebrow && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-400">
                {eyebrow}
              </span>
              {badge && <div>{badge}</div>}
            </div>
          )}
          <h1 className="text-2xl lg:text-3xl font-extrabold text-white font-heading tracking-tight">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-[#a1a1c2] leading-relaxed">
              {description}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex items-center gap-3 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
