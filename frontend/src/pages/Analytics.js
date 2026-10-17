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

const shortPeriod = (period, mode) => {
  const date = new Date(`${period}T12:00:00`);
  if (mode === 'month') return date.toLocaleString('en', { month: 'short' });
  if (mode === 'week') return date.toLocaleDateString('en', { day: 'numeric', month: 'short' });
  return date.toLocaleDateString('en', { day: 'numeric', month: 'short' });
};

const cardClass =
  'bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-5';

export default function Analytics() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [period, setPeriod] = useState('week');

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

  const chartData = period === 'month'
    ? data.by_month.map((m) => ({ period: m.month, count: m.count }))
    : data[period === 'week' ? 'by_week' : 'by_day'];
  const max = Math.max(1, ...chartData.map((m) => m.count));

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
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Documents scanned
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {period === 'day' ? 'Last 30 days' : period === 'week' ? 'Last 12 weeks' : 'Last 12 months'} · {data.documents} documents total · {data.folders} folder{data.folders === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex items-center rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {[
              ['day', 'Day'],
              ['week', 'Week'],
              ['month', 'Month'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPeriod(value)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${period === value ? 'bg-primary-500 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-end gap-1.5 sm:gap-2 h-52">
          {chartData.map((m) => {
            const pct = m.count > 0 ? Math.max(4, (m.count / max) * 100) : 1.5;
            return (
              <div
                key={m.period}
                className="flex-1 h-full flex flex-col items-center justify-end group"
                title={`${m.period}: ${m.count} document${m.count === 1 ? '' : 's'}`}
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
          {chartData.map((m) => (
            <span
              key={m.period}
              className="flex-1 text-center text-[11px] text-gray-400 dark:text-gray-500"
            >
              {shortPeriod(m.period, period)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
