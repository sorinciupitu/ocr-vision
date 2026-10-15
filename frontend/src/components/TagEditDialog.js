import React, { useEffect, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import toast from 'react-hot-toast';
import {
  PencilIcon, PlusIcon, SparklesIcon, TrashIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import api from '../services/api';
import ConfirmDialog from './ConfirmDialog';
import { tagColor, TAG_COLORS, TAG_KEYS } from './OrganizeDialog';

const inputCls =
  'flex-1 min-w-0 text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500';

const miniBtn =
  'inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50';

const announce = () => window.dispatchEvent(new CustomEvent('tags-changed'));

// The palette key a legacy (colorless) tag currently renders with — so the
// swatch shows its real color and saving makes it explicit.
const derivedKey = (name) => {
  const idx = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TAG_COLORS.length;
  return TAG_KEYS[idx];
};

/**
 * Edit one tag: rename, pick a palette color, and manage that tag's
 * auto-tag rules inline (edit pattern, toggle, delete, add).
 */
export default function TagEditDialog({ tag, onClose }) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color || derivedKey(tag.name));
  const [rules, setRules] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newPattern, setNewPattern] = useState('');
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [editPattern, setEditPattern] = useState('');

  const fetchRules = () => {
    api.get('/tag-rules')
      .then((r) => setRules(r.data.filter((x) => x.tag.id === tag.id)))
      .catch(() => {});
  };

  useEffect(fetchRules, [tag.id]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await api.put(`/tags/${tag.id}`, { name: trimmed, color });
      toast.success('Tag updated');
      announce();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update tag');
    }
    setSaving(false);
  };

  const deleteTag = async () => {
    setDeleting(true);
    try {
      await api.delete(`/tags/${tag.id}`);
      toast.success(`Tag "${tag.name}" deleted — documents keep their files`);
      announce();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete tag');
    }
    setDeleting(false);
  };

  // ---------- rules (apply immediately) ----------

  const addRule = async () => {
    const pattern = newPattern.trim();
    if (!pattern) return;
    setBusy(true);
    try {
      const res = await api.post('/tag-rules', { pattern, tag_id: tag.id });
      toast.success(
        res.data.matched_count > 0
          ? `Rule created — ${res.data.matched_count} document(s) tagged`
          : 'Rule created — will apply to matching documents'
      );
      setNewPattern('');
      fetchRules();
      announce();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create rule');
    }
    setBusy(false);
  };

  const updateRule = async (rule, patch) => {
    try {
      const res = await api.put(`/tag-rules/${rule.id}`, patch);
      if (patch.pattern != null) {
        toast.success(
          res.data.matched_count > 0
            ? `Rule updated — ${res.data.matched_count} document(s) tagged`
            : 'Rule updated'
        );
      }
      setEditingRuleId(null);
      fetchRules();
      announce();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update rule');
    }
  };

  const deleteRule = async (rule) => {
    try {
      await api.delete(`/tag-rules/${rule.id}`);
      toast.success('Rule deleted — tags already applied stay');
      fetchRules();
      announce();
    } catch (err) {
      toast.error('Failed to delete rule');
    }
  };

  return (
    <>
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
                      <PencilIcon className="w-5 h-5 text-primary-500" />
                      Edit tag
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Close">
                      <XMarkIcon className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Name */}
                  <div className="mt-5">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
                      Name
                    </label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && save()}
                      className={inputCls}
                      maxLength={100}
                      autoFocus
                    />
                  </div>

                  {/* Color */}
                  <div className="mt-4">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
                      Color
                    </label>
                    <div className="flex items-center gap-2">
                      {TAG_KEYS.map((key, i) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setColor(key)}
                          title={key}
                          aria-pressed={color === key}
                          className={`w-8 h-8 rounded-full ${TAG_COLORS[i].split(' ')[0]} transition-transform hover:scale-110 ${
                            color === key
                              ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-900'
                              : ''
                          }`}
                        />
                      ))}
                      <span className={`ml-1 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${tagColor({ name: tag.name, color })}`}>
                        preview
                      </span>
                    </div>
                  </div>

                  {/* Auto-tag rules */}
                  <div className="mt-5">
                    <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                      <SparklesIcon className="w-4 h-4 text-primary-500" />
                      Auto-tag rules
                    </label>

                    {rules.length === 0 && (
                      <p className="text-sm text-gray-400 dark:text-gray-500">
                        No rules yet — documents whose text or file name contain a keyword get this tag.
                      </p>
                    )}

                    <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {rules.map((r) => (
                        <li key={r.id} className="flex items-center gap-2 text-sm">
                          {editingRuleId === r.id ? (
                            <>
                              <input
                                value={editPattern}
                                onChange={(e) => setEditPattern(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && editPattern.trim()) updateRule(r, { pattern: editPattern.trim() });
                                  if (e.key === 'Escape') setEditingRuleId(null);
                                }}
                                className={inputCls}
                                maxLength={100}
                                autoFocus
                              />
                              <button
                                type="button"
                                className={miniBtn}
                                disabled={!editPattern.trim()}
                                onClick={() => updateRule(r, { pattern: editPattern.trim() })}
                              >
                                Save
                              </button>
                              <button type="button" className={miniBtn} onClick={() => setEditingRuleId(null)}>
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <span
                                className={`flex-1 min-w-0 truncate px-2 py-1 rounded-lg text-sm ${
                                  r.is_active
                                    ? 'text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800'
                                    : 'text-gray-400 dark:text-gray-500 line-through bg-gray-50 dark:bg-gray-800'
                                }`}
                                title={r.pattern}
                              >
                                {r.pattern}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateRule(r, { is_active: !r.is_active })}
                                className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                                  r.is_active ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'
                                }`}
                                title={r.is_active ? 'Active — click to disable' : 'Inactive — click to enable'}
                                role="switch"
                                aria-checked={r.is_active}
                              >
                                <span
                                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ml-[3px] ${
                                    r.is_active ? 'translate-x-[18px]' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                              <button
                                type="button"
                                className={`${miniBtn} !px-1.5`}
                                title="Edit pattern"
                                onClick={() => {
                                  setEditingRuleId(r.id);
                                  setEditPattern(r.pattern);
                                }}
                              >
                                <PencilIcon className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                className={`${miniBtn} !px-1.5 text-red-500 hover:text-red-600`}
                                title="Delete rule"
                                onClick={() => deleteRule(r)}
                              >
                                <TrashIcon className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>

                    <div className="flex gap-2 mt-2">
                      <input
                        value={newPattern}
                        onChange={(e) => setNewPattern(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addRule()}
                        placeholder="New keyword (e.g. chirias)..."
                        className={inputCls}
                        maxLength={100}
                      />
                      <button
                        type="button"
                        onClick={addRule}
                        disabled={busy || !newPattern.trim()}
                        className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-xl bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50"
                      >
                        <PlusIcon className="w-4 h-4" /> Add
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between gap-3 mt-6">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
                    >
                      <TrashIcon className="w-4 h-4" /> Delete tag
                    </button>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={save}
                        disabled={!canSave}
                        className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-xl disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete tag"
        message={`Delete "${tag.name}"? The tag is removed from every document; files and rules for other tags are untouched.`}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={deleteTag}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
