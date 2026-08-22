import React from 'react';

/**
 * StatBar — Horizontal comparison bar with consistent color mapping.
 *
 * @param {string} label - Left label
 * @param {number} value - Numerical value (0-100 or customized via max)
 * @param {number} [max=100] - Maximum scale value
 * @param {string} [displayValue] - Formatted value shown on right (e.g. '68.5%')
 * @param {string} [colorClass] - Tailwind bg color class (e.g. 'bg-purple-500')
 * @param {string} [colorHex] - Inline hex color override
 * @param {string} [sub] - Optional tiny descriptive subtitle
 */
export default function StatBar({
  label,
  value = 0,
  max = 100,
  displayValue,
  colorClass = 'bg-purple-500',
  colorHex,
  sub,
}) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className="space-y-1.5 w-full">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-[#f5f3ff] truncate max-w-[200px]" title={label}>
          {label}
        </span>
        <span className="font-mono text-[#a1a1c2] ml-2 shrink-0">
          {displayValue ?? `${Number(value).toFixed(1)}%`}
        </span>
      </div>

      <div className="progress-bar-bg">
        <div
          className={`progress-bar-fill ${colorClass}`}
          style={{
            width: `${percentage}%`,
            ...(colorHex ? { backgroundColor: colorHex } : {}),
          }}
        />
      </div>

      {sub && <div className="text-[11px] text-[#6b6b8f] truncate">{sub}</div>}
    </div>
  );
}
