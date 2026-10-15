import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { FolderIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import api from '../services/api';

export const TAG_COLORS = [
  'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300',
  'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300',
];

// Palette keys stored in tags.color (must match backend TAG_PALETTE).
export const TAG_KEYS = ['sky', 'emerald', 'amber', 'rose', 'violet', 'pink'];

// Accepts a tag object (uses its saved color) or a bare name (legacy
// behavior: derive the color from the name so old tags keep their look).
export const tagColor = (t) => {
  const name = typeof t === 'string' ? t : t.name;
  const key = typeof t === 'string' ? null : t.color;
  const saved = key != null ? TAG_KEYS.indexOf(key) : -1;
  if (saved >= 0) return TAG_COLORS[saved];
  return TAG_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TAG_COLORS.length];
};

// Solid dot variants (sidebar), same key order as TAG_COLORS.
const TAG_DOTS = [
  'bg-sky-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-violet-500', 'bg-pink-500',
];

export const tagDot = (t) => {
  const name = typeof t === 'string' ? t : t.name;
  const key = typeof t === 'string' ? null : t.color;
  const saved = key != null ? TAG_KEYS.indexOf(key) : -1;
  if (saved >= 0) return TAG_DOTS[saved];
  return TAG_DOTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TAG_DOTS.length];
};

export default function OrganizeDialog({ doc, folders, tags, onClose, onChanged }) {
  const [newFolder, setNewFolder] = useState('');
  const [newTag, setNewTag] = useState('');
  const [busy, setBusy] = useState(false);

  const currentTagIds = new Set((doc.tags || []).map((t) => t.id));

  const setFolder = async (folderId) => {
    setBusy(true);
    try {
      await api.put(`/documents/${doc.id}/folder`, { folder_id: folderId });
      onChanged();
    } catch (err) {
      toast.error('Failed to move document');
    }
    setBusy(false);
  };

  const setTags = async (tagIds) => {
    try {
      await api.put(`/documents/${doc.id}/tags`, { tag_ids: [...tagIds] });
      onChanged();
    } catch (err) {
      toast.error('Failed to update tags');
    }
  };

  const toggleTag = (tag) => {
    const next = new Set(currentTagIds);
    if (next.has(tag.id)) next.delete(tag.id);
    else next.add(tag.id);
    setTags(next);
  };

  const createFolder = async () => {
    const name = newFolder.trim();
    if (!name) return;
    try {
      const res = await api.post('/folders', { name });
      setNewFolder('');
      toast.success(`Folder "${res.data.name}" created`);
      onChanged();
      setFolder(res.data.id);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create folder');
    }
  };

  const createTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    setBusy(true);
    try {
      let tag;
      try {
        const res = await api.post('/tags', { name });
        tag = res.data;
      } catch (err) {
        // Likely already exists: attach the existing tag instead.
        const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
        if (!existing) throw err;
        tag = existing;
      }
      setNewTag('');
      await setTags([...currentTagIds, tag.id]);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create tag');
    }
    setBusy(false);
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
              <Dialog.Panel className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-6 shadow-xl">
                <div className="flex items-start justify-between">
                  <Dialog.Title className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate pr-4">
                    Organize document
                  </Dialog.Title>
                  <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" title="Close">
                    <XMarkIcon className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-1">{doc.original_filename}</p>

                {/* Folder */}
                <div className="mt-5">
                  <label className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Folder</label>
                  <div className="mt-2 space-y-1 max-h-44 overflow-y-auto pr-1">
                    <button
                      onClick={() => setFolder(null)}
                      disabled={busy}
                      className={`flex items-center w-full px-3 py-2 text-sm rounded-xl transition-colors ${
                        !doc.folder
                          ? 'bg-primary-500 text-white'
                          : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      <FolderIcon className="w-4 h-4 mr-2 flex-shrink-0" />
                      No folder
                    </button>
                    {folders.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setFolder(f.id)}
                        disabled={busy}
                        className={`flex items-center justify-between w-full px-3 py-2 text-sm rounded-xl transition-colors ${
                          doc.folder && doc.folder.id === f.id
                            ? 'bg-primary-500 text-white'
                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span className="flex items-center truncate">
                          <FolderIcon className="w-4 h-4 mr-2 flex-shrink-0" />
                          <span className="truncate">{f.name}</span>
                        </span>
                        <span className={`text-xs ml-2 ${doc.folder && doc.folder.id === f.id ? 'text-primary-100' : 'text-gray-400'}`}>
                          {f.document_count}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newFolder}
                      onChange={(e) => setNewFolder(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && createFolder()}
                      placeholder="New folder name..."
                      className="flex-1 text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <button
                      onClick={createFolder}
                      disabled={busy || !newFolder.trim()}
                      className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-50"
                    >
                      <PlusIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Tags */}
                <div className="mt-6">
                  <label className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Tags</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {tags.length === 0 && (
                      <p className="text-sm text-gray-400 dark:text-gray-500">No tags yet — create one below.</p>
                    )}
                    {tags.map((t) => {
                      const active = currentTagIds.has(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => toggleTag(t)}
                          disabled={busy}
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-opacity ${
                            active ? tagColor(t) : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500 opacity-60 hover:opacity-100'
                          }`}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && createTag()}
                      placeholder="New tag name..."
                      className="flex-1 text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <button
                      onClick={createTag}
                      disabled={busy || !newTag.trim()}
                      className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-primary-500 rounded-xl hover:bg-primary-600 disabled:opacity-50"
                    >
                      <PlusIcon className="w-4 h-4" />
                    </button>
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
