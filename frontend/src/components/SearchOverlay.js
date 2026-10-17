import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowPathIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import api from '../services/api';

const kbd =
  'inline-flex items-center justify-center min-w-[18px] px-1 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded';

// ts_headline wraps matches in <b>...</b> (PostgreSQL defaults). Escape
// everything else first so OCR text (user content) can never inject markup,
// then restore only the highlight tags we expect.
const safeSnippet = (html) => ({
  __html: (html || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;b&gt;/g, '<b>')
    .replace(/&lt;\/b&gt;/g, '</b>')
    .replace(/&lt;mark&gt;/g, '<mark>')
    .replace(/&lt;\/mark&gt;/g, '</mark>'),
});

function HighlightedName({ name, query }) {
  const q = query.trim();
  if (!q) return <>{name}</>;
  const terms = [...new Set(q.split(/\s+/).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return <>{name}</>;
  const matcher = new RegExp(`(${terms.join('|')})`, 'ig');
  return name.split(matcher).map((part, index) => (
    terms.some((term) => part.toLowerCase() === term.toLowerCase()) ? (
      <mark key={index} className="bg-transparent text-primary-600 dark:text-primary-400 font-bold">{part}</mark>
    ) : <React.Fragment key={index}>{part}</React.Fragment>
  ));
}

/** Command-palette style search over the archive, in the spirit of vite.dev:
 *  a full-screen overlay above the current page with a blurred backdrop. */
export default function SearchOverlay({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Reset + focus when opened; lock background scrolling like vite.dev.
  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setResults([]);
    setActive(0);
    if (inputRef.current) inputRef.current.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Debounced search as you type.
  useEffect(() => {
    if (!open) return undefined;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .get('/documents/search', { params: { query: q } })
        .then((res) => {
          setResults(res.data);
          setActive(0);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [query, open]);

  // Keep the keyboard-highlighted row in view.
  useEffect(() => {
    const el = listRef.current && listRef.current.children[active];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  if (!open) return null;

  const openDoc = (id) => {
    onClose();
    navigate(`/document/${id}`);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      openDoc(results[active].document.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] backdrop-blur-sm bg-black/40 flex items-start justify-center px-4 pt-[12vh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Search documents"
    >
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="w-full max-w-2xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-800 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4 border-b border-gray-100 dark:border-gray-800">
          <MagnifyingGlassIcon className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search documents by text or filename…"
            className="flex-1 py-4 bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none"
          />
          {loading && <ArrowPathIcon className="w-4 h-4 animate-spin text-primary-500" />}
          <span className={`${kbd} hidden sm:inline-flex`}>esc</span>
        </div>

        {/* Results */}
        <ul ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {results.map((r, i) => (
            <li key={r.document.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => openDoc(r.document.id)}
                className={`w-full text-left px-4 py-3 flex flex-col gap-1 transition-colors ${
                  i === active ? 'bg-primary-50 dark:bg-primary-500/10' : ''
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  <HighlightedName name={r.document.original_filename} query={query} />
                  {r.document.folder && (
                    <span className="text-[11px] font-normal text-gray-400 dark:text-gray-500 flex-shrink-0">
                      in {r.document.folder.name}
                    </span>
                  )}
                </span>
                <span
                  className="search-snippet text-xs text-gray-500 dark:text-gray-400 line-clamp-2"
                  dangerouslySetInnerHTML={safeSnippet(r.snippet)}
                />
              </button>
            </li>
          ))}
          {query.trim() && !loading && results.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No documents match “{query.trim()}”.
            </li>
          )}
          {!query.trim() && (
            <li className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              Type to search your OCR text and filenames.
            </li>
          )}
        </ul>

        {/* Keyboard hints, vite.dev style */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 dark:text-gray-500">
          <span className="inline-flex items-center gap-1">
            <span className={kbd}>↑</span>
            <span className={kbd}>↓</span>
            to navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={kbd}>↵</span>
            to open
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={kbd}>esc</span>
            to close
          </span>
        </div>
      </motion.div>
    </div>
  );
}
