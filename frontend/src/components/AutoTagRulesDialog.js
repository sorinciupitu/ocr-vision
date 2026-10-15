import React, { useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import toast from 'react-hot-toast';
import { PlusIcon, SparklesIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import api from '../services/api';
import { tagColor } from './OrganizeDialog';

const inputCls =
  'flex-1 min-w-0 text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500';

/**
 * Manage auto-tagging rules: documents whose OCR text or filename contain the
 * pattern get the tag — on OCR completion and, at creation time, backfilled
 * over existing documents.
 */
export default function AutoTagRulesDialog({ tags, onClose, onChanged }) {
  const [rules, setRules] = useState([]);
  const [pattern, setPattern] = useState('');
  const [tagId, setTagId] = useState('');
  const [useNewTag, setUseNewTag] = useState(tags.length === 0);
  const [newTag, setNewTag] = useState('');
  const [busy, setBusy] = useState(false);

  const fetchRules = () => {
    api.get('/tag-rules').then((r) => setRules(r.data)).catch(() => {});
  };

  useEffect(fetchRules, []);

  useEffect(() => {
    if (!tagId && tags.length) setTagId(tags[0].id);
  }, [tags, tagId]);

  const needNewTag = useNewTag || !tags.length;
  const canCreate = pattern.trim() && (!needNewTag || newTag.trim());

  const resolveTagId = async () => {
    const name = newTag.trim();
    try {
      const res = await api.post('/tags', { name });
      return res.data.id;
    } catch (err) {
      // Likely already exists: reuse it.
      const existing = (await api.get('/tags')).data.find(
        (t) => t.name.toLowerCase() === name.toLowerCase()
      );
      if (!existing) throw err;
      return existing.id;
    }
  };

  const createRule = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      const tid = needNewTag ? await resolveTagId() : tagId;
      const res = await api.post('/tag-rules', { pattern: pattern.trim(), tag_id: tid });
      toast.success(
        res.data.matched_count > 0
          ? `Rule created — ${res.data.matched_count} document(s) tagged`
          : 'Rule created — will apply to matching documents'
      );
      setPattern('');
      setNewTag('');
      fetchRules();
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create rule');
    }
    setBusy(false);
  };

  const deleteRule = async (rule) => {
    try {
      await api.delete(`/tag-rules/${rule.id}`);
      toast.success('Rule deleted — tags already applied stay');
      fetchRules();
      onChanged();
    } catch (err) {
      toast.error('Failed to delete rule');
    }
  };

  return (
    <Transition appear show={true} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/40" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="ease-in duration-150" leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6 shadow-xl">
                <div className="flex items-start justify-between">
                  <Dialog.Title className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <SparklesIcon className="w-5 h-5 text-primary-500" />
                    Auto-tag rules
                  </Dialog.Title>
                  <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Close">
                    <XMarkIcon className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Documents whose scanned text or file name contain the keyword automatically receive the tag.
                </p>

                {/* Create rule */}
                <div className="mt-5 space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={pattern}
                      onChange={(e) => setPattern(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && createRule()}
                      placeholder="Keyword, e.g. contract"
                      className={inputCls}
                    />
                    <select
                      value={needNewTag ? '__new' : tagId}
                      onChange={(e) => setUseNewTag(e.target.value === '__new')}
                      disabled={busy}
                      className={`${inputCls} flex-shrink-0`}
                    >
                      {tags.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                      <option value="__new">+ New tag…</option>
                    </select>
                  </div>
                  {needNewTag && (
                    <input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && createRule()}
                      placeholder="New tag name…"
                      className={`w-full ${inputCls}`}
                    />
                  )}
                  <button
                    onClick={createRule}
                    disabled={busy || !canCreate}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-50"
                  >
                    <PlusIcon className="w-4 h-4" />
                    Create rule
                  </button>
                </div>

                {/* Rules list */}
                <div className="mt-6">
                  <label className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    Active rules ({rules.length})
                  </label>
                  <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {rules.length === 0 && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">No rules yet.</p>
                    )}
                    {rules.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700"
                      >
                        <div className="flex items-center gap-2 min-w-0 text-sm">
                          <span className="text-gray-400">“</span>
                          <span className="font-mono text-gray-800 dark:text-gray-200 truncate">{r.pattern}</span>
                          <span className="text-gray-400">”</span>
                          <span className="text-gray-400">→</span>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${tagColor(r.tag)}`}>
                            {r.tag.name}
                          </span>
                        </div>
                        <button
                          onClick={() => deleteRule(r)}
                          className="text-gray-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 flex-shrink-0"
                          title="Delete rule"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700"
                  >
                    Done
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
