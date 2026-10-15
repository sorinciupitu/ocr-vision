import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon, CheckCircleIcon, ChevronDownIcon,
  ExclamationTriangleIcon, QueueListIcon, XMarkIcon,
} from '@heroicons/react/24/outline';

const fmtSize = (bytes) => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const formatEta = (sec) => {
  if (sec == null) return null;
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
};

const uploadStatusLabel = { queued: 'Waiting…', uploading: 'Uploading…', done: 'Done', error: 'Failed' };

/**
 * Upload + OCR processing queue panel.
 *
 * Uploads come from the browser-side queue (per-file progress and retry);
 * processing stats come from the documents list the Dashboard already polls.
 */
export default function ProcessingQueue({
  uploads,
  documents,
  busyId,
  onRetryUpload,
  onRetryAllUploads,
  onClearFinished,
  onRetryDoc,
  onReprocessDoc,
  onRetryAllFailed,
}) {
  const [open, setOpen] = useState(false);

  const stats = useMemo(() => {
    const s = { pending: 0, processing: 0, completed: 0, failed: 0 };
    const durations = [];
    documents.forEach((d) => {
      s[d.ocr_status] = (s[d.ocr_status] || 0) + 1;
      if (d.ocr_status === 'completed' && d.created_at && d.updated_at) {
        const sec = (new Date(d.updated_at) - new Date(d.created_at)) / 1000;
        // Guard against clock jumps / reprocess artifacts.
        if (sec >= 0 && sec < 24 * 3600) durations.push(sec);
      }
    });
    const recent = durations.slice(-20);
    const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
    const remaining = s.pending + s.processing;
    return {
      ...s,
      remaining,
      eta: avg != null && remaining > 0 ? formatEta(Math.round(avg * remaining)) : null,
    };
  }, [documents]);

  const activeUploads = uploads.filter((u) => u.status === 'queued' || u.status === 'uploading');
  const failedUploads = uploads.filter((u) => u.status === 'error');
  const doneUploads = uploads.filter((u) => u.status === 'done');
  const failedDocs = documents.filter((d) => d.ocr_status === 'failed');
  const queuedDocs = documents.filter((d) => d.ocr_status === 'pending' || d.ocr_status === 'processing');

  const badgeCount = activeUploads.length + failedUploads.length + stats.remaining + stats.failed;
  const hasActivity = badgeCount > 0;

  useEffect(() => {
    if (hasActivity) setOpen(true);
  }, [hasActivity]);

  const sectionTitle = 'text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';
  const miniBtn =
    'inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50';

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <QueueListIcon className="w-5 h-5 text-primary-500" />
          Processing queue
          {badgeCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary-500 text-white text-[11px] font-bold">
              {badgeCount}
            </span>
          )}
        </span>
        <span className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          {!open && hasActivity && (
            <span>
              {activeUploads.length > 0 && `${activeUploads.length} uploading · `}
              {stats.remaining > 0 && `${stats.remaining} to process${stats.eta ? ` · ≈ ${stats.eta}` : ''}`}
              {stats.failed > 0 && ` · ${stats.failed} failed`}
            </span>
          )}
          <ChevronDownIcon className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-4 space-y-5">
          {/* Uploads */}
          {uploads.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className={sectionTitle}>
                  Uploads · {doneUploads.length}/{uploads.length} done
                </span>
                <span className="flex items-center gap-2">
                  {failedUploads.length > 1 && (
                    <button type="button" className={miniBtn} onClick={onRetryAllUploads}>
                      <ArrowPathIcon className="w-3.5 h-3.5" /> Retry all ({failedUploads.length})
                    </button>
                  )}
                  {doneUploads.length > 0 && (
                    <button type="button" className={miniBtn} onClick={onClearFinished}>
                      <XMarkIcon className="w-3.5 h-3.5" /> Clear finished
                    </button>
                  )}
                </span>
              </div>
              <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {uploads.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-gray-800 dark:text-gray-200" title={u.name}>
                        {u.name}
                      </span>
                      {u.status === 'error' && u.error && (
                        <span className="block truncate text-xs text-red-600 dark:text-red-400" title={u.error}>
                          {u.error}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">{fmtSize(u.size)}</span>
                    {u.status === 'uploading' && (
                      <span className="w-28 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden flex-shrink-0" title={`${u.progress}%`}>
                        <span className="block h-full bg-primary-500 transition-all" style={{ width: `${u.progress}%` }} />
                      </span>
                    )}
                    {u.status === 'done' && <CheckCircleIcon className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                    {u.status === 'error' ? (
                      <button
                        type="button"
                        className={`${miniBtn} flex-shrink-0`}
                        onClick={() => onRetryUpload(u.id)}
                      >
                        <ArrowPathIcon className="w-3.5 h-3.5" /> Retry
                      </button>
                    ) : (
                      <span className={`text-xs flex-shrink-0 ${u.status === 'uploading' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500'}`}>
                        {uploadStatusLabel[u.status]}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* OCR processing */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className={sectionTitle}>OCR processing</span>
              {failedDocs.length > 1 && (
                <button type="button" className={miniBtn} onClick={onRetryAllFailed}>
                  <ArrowPathIcon className="w-3.5 h-3.5" /> Retry all failed ({failedDocs.length})
                </button>
              )}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {stats.pending} queued · {stats.processing} processing · {stats.completed} completed ·{' '}
              <span className={stats.failed > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>{stats.failed} failed</span>
              {stats.remaining > 0 && stats.eta && (
                <span className="text-gray-400 dark:text-gray-500"> · ≈ {stats.eta} remaining (approx.)</span>
              )}
            </p>

            {failedDocs.length > 0 && (
              <ul className="mt-2 space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {failedDocs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 text-sm">
                    <ExclamationTriangleIcon className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-gray-800 dark:text-gray-200" title={d.original_filename}>{d.original_filename}</span>
                      {d.ocr_error && (
                        <span className="block truncate text-xs text-red-600 dark:text-red-400" title={d.ocr_error}>{d.ocr_error}</span>
                      )}
                    </span>
                    <button
                      type="button"
                      className={`${miniBtn} flex-shrink-0`}
                      disabled={busyId === d.id}
                      onClick={() => onRetryDoc(d)}
                    >
                      <ArrowPathIcon className={`w-3.5 h-3.5 ${busyId === d.id ? 'animate-spin' : ''}`} /> Retry
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {queuedDocs.length > 0 && (
              <ul className="mt-2 space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {queuedDocs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200" title={d.original_filename}>
                      {d.original_filename}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                      {d.ocr_status === 'processing' ? `processing (attempt ${d.ocr_attempts})` : 'queued'}
                    </span>
                    <button
                      type="button"
                      className={`${miniBtn} flex-shrink-0`}
                      disabled={busyId === d.id}
                      title="Reprocess from scratch"
                      onClick={() => onReprocessDoc(d)}
                    >
                      <ArrowPathIcon className={`w-3.5 h-3.5 ${busyId === d.id ? 'animate-spin' : ''}`} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {stats.remaining === 0 && stats.failed === 0 && uploads.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Nothing in the queue.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
