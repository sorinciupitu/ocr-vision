import React, { useEffect, useState } from 'react';
import api from '../services/api';
import {
  DocumentIcon, DocumentTextIcon, LanguageIcon, TagIcon,
} from '@heroicons/react/24/outline';

const fmt = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${n}`;
};

const shortMonth = (ym) =>
  new Date(`${ym}-01T00:00:00`).toLocaleString('en', { month: 'short' });

const cardClass =
  'bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5';

export default function Analytics() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get('/analytics/summary')
      .then((r) => setData(r.data))
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <div className={`${cardClass} p-16 text-center text-gray-500 dark:text-gray-400`}>
        Failed to load analytics.
      </div>
    );
  }
  if (!data) {
    return <div className="text-gray-500 dark:text-gray-400 animate-pulse">Loading analytics...</div>;
  }

  const max = Math.max(1, ...data.by_month.map((m) => m.count));

  const stats = [
    { label: 'Documents', value: data.documents, icon: DocumentIcon, color: 'text-primary-500' },
    { label: 'Pages', value: data.pages, icon: DocumentTextIcon, color: 'text-emerald-500' },
    { label: 'Words', value: data.words, icon: LanguageIcon, color: 'text-amber-500' },
    { label: 'Tags', value: data.tags, icon: TagIcon, color: 'text-violet-500' },
  ];

  return (
    <div className="space-y-8">
      {/* Totals */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className={cardClass}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  {s.label}
                </p>
                <Icon className={`w-5 h-5 ${s.color}`} />
              </div>
              <p className="mt-3 text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
                {fmt(s.value)}
              </p>
            </div>
          );
        })}
      </div>

      {/* Documents per month */}
      <div className={cardClass}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Documents scanned per month
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Last 12 months · {data.documents} documents total · {data.folders} folder{data.folders === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <div className="flex items-end gap-1.5 sm:gap-2 h-52">
          {data.by_month.map((m) => {
            const pct = m.count > 0 ? Math.max(4, (m.count / max) * 100) : 1.5;
            return (
              <div
                key={m.month}
                className="flex-1 h-full flex flex-col items-center justify-end group"
                title={`${m.month}: ${m.count} document${m.count === 1 ? '' : 's'}`}
              >
                <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">
                  {m.count > 0 ? m.count : ''}
                </span>
                <div
                  className={`w-full rounded-t-md transition-colors ${
                    m.count > 0
                      ? 'bg-primary-500 group-hover:bg-primary-600'
                      : 'bg-gray-200 dark:bg-gray-800'
                  }`}
                  style={{ height: `${pct}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-1.5 sm:gap-2 mt-2">
          {data.by_month.map((m) => (
            <span
              key={m.month}
              className="flex-1 text-center text-[11px] text-gray-400 dark:text-gray-500"
            >
              {shortMonth(m.month)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
