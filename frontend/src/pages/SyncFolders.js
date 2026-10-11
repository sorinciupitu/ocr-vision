import React, { useState, useEffect } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { FolderPlusIcon, FolderIcon, ArrowPathIcon, TrashIcon } from '@heroicons/react/24/outline';

const DOT_COLORS = ['bg-primary-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-sky-500', 'bg-violet-500'];

export default function SyncFolders() {
  const [folders, setFolders] = useState([]);
  const [path, setPath] = useState('');
  const [label, setLabel] = useState('');
  const [scanning, setScanning] = useState(null);

  const fetchFolders = async () => {
    try {
      const res = await api.get('/sync/folders');
      setFolders(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { fetchFolders(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!path.trim()) return;
    try {
      await api.post('/sync/folders', { path: path.trim(), label: label.trim() || null });
      toast.success('Folder added');
      setPath('');
      setLabel('');
      fetchFolders();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to add folder');
    }
  };

  const handleScan = async (folderId) => {
    setScanning(folderId);
    try {
      const res = await api.post(`/sync/folders/${folderId}/scan`);
      toast.success(`Found ${res.data.files_found} files, ${res.data.files_queued} queued for OCR`);
      fetchFolders();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Scan failed');
    }
    setScanning(null);
  };

  const handleDelete = async (folderId) => {
    try {
      await api.delete(`/sync/folders/${folderId}`);
      toast.success('Folder removed');
      fetchFolders();
    } catch (err) {
      toast.error('Failed to remove folder');
    }
  };

  const cardClass = 'bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm';
  const inputClass = 'px-4 py-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm';

  return (
    <div className="space-y-8">
      <div className={`${cardClass} p-8`}>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 mb-2">Sync Folders</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Add local directories containing PDF, DOCX, or image files. Click "Scan" to process and index them for search.</p>

        <form onSubmit={handleAdd} className="flex gap-4 flex-wrap">
          <input
            type="text"
            className={`flex-1 min-w-[250px] ${inputClass}`}
            placeholder="Folder path (e.g. /data/scans)"
            value={path}
            onChange={e => setPath(e.target.value)}
          />
          <input
            type="text"
            className={`w-48 ${inputClass}`}
            placeholder="Label (optional)"
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
          <button
            type="submit"
            className="px-6 py-3 bg-primary-500 text-white font-medium rounded-xl hover:bg-primary-600 transition-colors flex items-center gap-2"
          >
            <FolderPlusIcon className="w-5 h-5" />
            Add Folder
          </button>
        </form>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Configured Folders</h3>
        {folders.length === 0 ? (
          <div className={`${cardClass} p-16 text-center text-gray-500 dark:text-gray-400`}>
            <FolderIcon className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p>No sync folders configured yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {folders.map((f, i) => (
              <div key={f.id} className={`${cardClass} p-5 flex items-center justify-between gap-4`}>
                <div className="flex items-center space-x-4 min-w-0">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white flex-shrink-0 ${DOT_COLORS[i % DOT_COLORS.length]}`}>
                    <FolderIcon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{f.label || f.path}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{f.path}</p>
                    {f.last_synced_at && (
                      <p className="text-xs text-gray-400 dark:text-gray-500">Last synced: {new Date(f.last_synced_at).toLocaleString()}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2 flex-shrink-0">
                  <button
                    onClick={() => handleScan(f.id)}
                    disabled={scanning === f.id}
                    className="inline-flex items-center px-4 py-2 text-sm font-medium text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-500/10 rounded-xl hover:bg-primary-100 dark:hover:bg-primary-500/20 transition-colors disabled:opacity-50"
                  >
                    <ArrowPathIcon className={`w-4 h-4 mr-2 ${scanning === f.id ? 'animate-spin' : ''}`} />
                    {scanning === f.id ? 'Scanning...' : 'Scan'}
                  </button>
                  <button
                    onClick={() => handleDelete(f.id)}
                    className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-colors"
                    title="Remove folder"
                  >
                    <TrashIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
