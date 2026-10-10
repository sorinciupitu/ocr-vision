import React, { useState, useEffect } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { FolderPlusIcon, FolderIcon, ArrowPathIcon, TrashIcon } from '@heroicons/react/24/outline';

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

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-6">Sync Folders</h2>
        <p className="text-sm text-gray-500 mb-6">Add local directories containing PDF, DOCX, or image files. Click "Scan" to process and index them for search.</p>
        
        <form onSubmit={handleAdd} className="flex gap-4 flex-wrap">
          <input
            type="text"
            className="flex-1 min-w-[250px] px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            placeholder="Folder path (e.g. /data/scans)"
            value={path}
            onChange={e => setPath(e.target.value)}
          />
          <input
            type="text"
            className="w-48 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
            placeholder="Label (optional)"
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
          <button
            type="submit"
            className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors flex items-center gap-2"
          >
            <FolderPlusIcon className="w-5 h-5" />
            Add Folder
          </button>
        </form>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-200">
          <h3 className="text-lg leading-6 font-medium text-gray-900">Configured Folders</h3>
        </div>
        <ul className="divide-y divide-gray-200">
          {folders.map((f) => (
            <li key={f.id} className="p-6 flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <FolderIcon className="h-8 w-8 text-amber-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{f.label || f.path}</p>
                  <p className="text-xs text-gray-500">{f.path}</p>
                  {f.last_synced_at && (
                    <p className="text-xs text-gray-400">Last synced: {new Date(f.last_synced_at).toLocaleString()}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleScan(f.id)}
                  disabled={scanning === f.id}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors disabled:opacity-50"
                >
                  <ArrowPathIcon className={`w-4 h-4 mr-2 ${scanning === f.id ? 'animate-spin' : ''}`} />
                  {scanning === f.id ? 'Scanning...' : 'Scan'}
                </button>
                <button
                  onClick={() => handleDelete(f.id)}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <TrashIcon className="w-5 h-5" />
                </button>
              </div>
            </li>
          ))}
          {folders.length === 0 && (
            <li className="p-12 text-center text-gray-500">
              <FolderIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p>No sync folders configured yet.</p>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
