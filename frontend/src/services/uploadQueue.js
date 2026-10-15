import api from './api';
import toast from 'react-hot-toast';

// Shared upload queue: every upload path in the app (dashboard dropzone,
// hero input, header/FAB button) goes through here so progress, retries and
// duplicate warnings behave the same everywhere. Module-level store with
// subscribers; no React dependency.

let state = { uploads: [], dupDialog: null };
const listeners = new Set();
let seq = 0;

const emit = () => listeners.forEach((l) => l());

export function subscribeUploads(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUploadState() {
  return state;
}

const patch = (id, patch) => {
  state = { ...state, uploads: state.uploads.map((it) => (it.id === id ? { ...it, ...patch } : it)) };
  emit();
};

async function processEntries(entries) {
  for (const entry of entries) {
    patch(entry.id, { status: 'uploading', progress: 0 });
    const formData = new FormData();
    formData.append('file', entry.file);
    if (entry.folderId) formData.append('folder_id', entry.folderId);
    try {
      await api.post('/documents/upload', formData, {
        onUploadProgress: (e) => {
          if (e.total) patch(entry.id, { progress: Math.round((e.loaded * 100) / e.total) });
        },
      });
      patch(entry.id, { status: 'done', progress: 100 });
      toast.success(`Uploaded ${entry.name}`);
      window.dispatchEvent(new CustomEvent('docs-changed'));
    } catch (err) {
      patch(entry.id, {
        status: 'error',
        error: err.response?.data?.detail || err.message || 'Upload failed',
      });
      const detail = err.response?.data?.detail;
      const message = typeof detail === 'string' ? detail : (err.message || 'Upload failed');
      toast.error(`Failed to upload ${entry.name}: ${message}`);
    }
  }
}

function enqueue(files, folderId) {
  if (!files.length) return;
  const entries = files.map((f) => ({
    id: `up-${(seq += 1)}`,
    file: f,
    name: f.name,
    size: f.size,
    folderId: folderId || null,
    status: 'queued',
    progress: 0,
    error: null,
  }));
  state = { ...state, uploads: [...state.uploads, ...entries] };
  emit();
  processEntries(entries);
}

/**
 * Queue files for upload after warning about names that already exist
 * (on the server, or twice within the batch itself). Duplicates open a
 * dialog in the store state; nothing uploads until it is resolved.
 */
export async function enqueueUploadFiles(files, folderId) {
  const list = Array.from(files || []);
  if (!list.length) return;
  let existing = [];
  try {
    const res = await api.post('/documents/duplicates/check', { names: list.map((f) => f.name) });
    existing = (res.data.existing || []).map((n) => n.toLowerCase());
  } catch {
    existing = []; // the check is advisory: never block uploads on its failure
  }
  const seen = new Set();
  const duplicates = [];
  const fresh = [];
  list.forEach((f) => {
    const key = f.name.toLowerCase();
    const isDup = existing.includes(key) || seen.has(key);
    seen.add(key);
    (isDup ? duplicates : fresh).push(f);
  });
  if (duplicates.length === 0) {
    enqueue(list, folderId);
    return;
  }
  state = {
    ...state,
    dupDialog: {
      names: duplicates.map((f) => f.name),
      all: list,
      fresh,
      folderId: folderId || null,
    },
  };
  emit();
}

/** User answered the duplicate dialog: 'skip' | 'anyway' | 'cancel'. */
export function resolveDuplicates(mode) {
  const dialog = state.dupDialog;
  if (!dialog) return;
  state = { ...state, dupDialog: null };
  emit();
  if (mode === 'skip') enqueue(dialog.fresh, dialog.folderId);
  else if (mode === 'anyway') enqueue(dialog.all, dialog.folderId);
}

export function retryUpload(id) {
  const entry = state.uploads.find((it) => it.id === id);
  if (!entry) return;
  const retried = { ...entry, status: 'queued', progress: 0, error: null };
  state = { ...state, uploads: state.uploads.map((it) => (it.id === id ? retried : it)) };
  emit();
  processEntries([retried]);
}

export function retryAllUploads() {
  const entries = state.uploads
    .filter((it) => it.status === 'error')
    .map((it) => ({ ...it, status: 'queued', progress: 0, error: null }));
  if (!entries.length) return;
  const byId = new Map(entries.map((e) => [e.id, e]));
  state = { ...state, uploads: state.uploads.map((it) => byId.get(it.id) || it) };
  emit();
  processEntries(entries);
}

export function clearFinishedUploads() {
  state = { ...state, uploads: state.uploads.filter((it) => it.status !== 'done') };
  emit();
}
