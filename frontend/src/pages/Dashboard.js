import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import api, { mediaUrl } from '../services/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import {
  CloudArrowUpIcon, EyeIcon, DocumentMagnifyingGlassIcon,
  ArrowPathIcon, TrashIcon, ArrowTopRightOnSquareIcon,
  MagnifyingGlassIcon, FolderArrowDownIcon, ArrowUpTrayIcon
} from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import Thumbnail from '../components/Thumbnail';
import ConfirmDialog from '../components/ConfirmDialog';

const statusStyle = {
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  processing: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  pending: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

export default function Dashboard() {
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [confirmDoc, setConfirmDoc] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [sortBy, setSortBy] = useState('recent');
  const navigate = useNavigate();
  const heroInputRef = useRef(null);

  const fetchDocuments = async () => {
    try {
      const res = await api.get('/documents');
      setDocuments(res.data);
    } catch (err) {
      toast.error("Failed to load documents");
    }
  };

  useEffect(() => {
    fetchDocuments();
    const interval = setInterval(fetchDocuments, 5000);
    return () => clearInterval(interval);
  }, []);

  const uploadFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      try {
        await api.post('/documents/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        toast.success(`Uploaded ${file.name}`);
      } catch (err) {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    setUploading(false);
    fetchDocuments();
  }, []);

  const onDrop = useCallback((acceptedFiles) => uploadFiles(acceptedFiles), [uploadFiles]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  const sortedDocuments = useMemo(() => {
    const list = [...documents];
    if (sortBy === 'name') list.sort((a, b) => a.original_filename.localeCompare(b.original_filename));
    else if (sortBy === 'status') list.sort((a, b) => a.ocr_status.localeCompare(b.ocr_status));
    else list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return list;
  }, [documents, sortBy]);

  const handleReprocess = async (doc) => {
    setBusyId(doc.id);
    try {
      await api.post(`/documents/${doc.id}/reprocess`);
      toast.success(`Reprocessing ${doc.original_filename}`);
      fetchDocuments();
    } catch (err) {
      toast.error('Failed to reprocess document');
    }
    setBusyId(null);
  };

  const handleDelete = async () => {
    if (!confirmDoc) return;
    setDeleting(true);
    try {
      await api.delete(`/documents/${confirmDoc.id}`);
      toast.success('Document deleted');
      setConfirmDoc(null);
      fetchDocuments();
    } catch (err) {
      toast.error('Failed to delete document');
    }
    setDeleting(false);
  };

  const openOriginal = (doc) => {
    window.open(mediaUrl(`/documents/${doc.id}/file?disposition=inline`), '_blank', 'noopener');
  };

  const quickActions = [
    { label: 'Upload documents', desc: 'Add PDFs or images to the archive', icon: ArrowUpTrayIcon, onClick: () => heroInputRef.current && heroInputRef.current.click() },
    { label: 'Search archive', desc: 'Full-text search across OCR text', icon: MagnifyingGlassIcon, onClick: () => navigate('/search') },
    { label: 'Sync folders', desc: 'Index files from a local directory', icon: FolderArrowDownIcon, onClick: () => navigate('/sync') },
  ];

  const cardClass = 'bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm';
  const iconBtn = 'text-gray-400 dark:text-gray-500 hover:text-primary-600 p-1.5 rounded-full hover:bg-primary-50 dark:hover:bg-gray-800 transition-colors';

  return (
    <div className="space-y-8">
      {/* Get started */}
      <div className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-3xl p-8 text-white shadow-sm">
        <h2 className="text-2xl font-bold tracking-tight">Get started with DocManager</h2>
        <p className="text-primary-100 mt-1 text-sm">Scan, archive and search your documents with OCR.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                onClick={action.onClick}
                className="text-left bg-white/10 hover:bg-white/20 rounded-2xl p-4 transition-colors"
              >
                <Icon className="w-6 h-6 mb-2" />
                <p className="font-semibold text-sm">{action.label}</p>
                <p className="text-xs text-primary-100 mt-0.5">{action.desc}</p>
              </button>
            );
          })}
        </div>
        <input
          ref={heroInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.docx"
          className="hidden"
          onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-2xl cursor-pointer transition-colors ${
          isDragActive
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-500/10'
            : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-400'
        }`}
      >
        <input {...getInputProps()} />
        <CloudArrowUpIcon className="w-10 h-10 text-gray-400 dark:text-gray-500 mb-3" />
        <p className="font-medium text-gray-700 dark:text-gray-200">
          {isDragActive ? "Drop the files here..." : "Drag & drop files here, or click to select"}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Supports PDF, DOCX, PNG, JPG, JPEG, TIFF (Max 50MB)</p>
        {uploading && <div className="mt-3 text-primary-600 font-medium animate-pulse">Uploading...</div>}
      </div>

      {/* Recent archives */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Recent Archives</h3>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="recent">Sort By: Recent</option>
            <option value="name">Sort By: Name</option>
            <option value="status">Sort By: Status</option>
          </select>
        </div>

        {sortedDocuments.length === 0 ? (
          <div className={`${cardClass} p-16 text-center text-gray-500 dark:text-gray-400`}>
            <DocumentMagnifyingGlassIcon className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p>No documents archived yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            {sortedDocuments.map((doc) => (
              <div key={doc.id} className={`${cardClass} hover:shadow-md transition-shadow overflow-hidden flex flex-col`}>
                <button
                  type="button"
                  onClick={() => navigate(`/document/${doc.id}`)}
                  className="block w-full"
                >
                  <Thumbnail document={doc} className="w-full h-40 rounded-none border-b border-gray-100 dark:border-gray-800" />
                </button>
                <div className="p-4 flex flex-col flex-1">
                  <button
                    type="button"
                    onClick={() => navigate(`/document/${doc.id}`)}
                    className="text-sm font-semibold text-gray-900 dark:text-gray-100 hover:text-primary-600 text-left truncate"
                    title={doc.original_filename}
                  >
                    {doc.original_filename}
                  </button>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {format(new Date(doc.created_at), 'PP')} • {(doc.file_size / 1024 / 1024).toFixed(2)} MB • {doc.page_count} pg
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[doc.ocr_status] || statusStyle.pending}`}>
                      {doc.ocr_status}
                    </span>
                    <div className="flex items-center space-x-1">
                      <button onClick={() => openOriginal(doc)} className={iconBtn} title="View original file">
                        <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleReprocess(doc)} disabled={busyId === doc.id} className={`${iconBtn} disabled:opacity-50`} title="Reprocess OCR">
                        <ArrowPathIcon className={`w-4 h-4 ${busyId === doc.id ? 'animate-spin' : ''}`} />
                      </button>
                      <button onClick={() => navigate(`/document/${doc.id}`)} className={iconBtn} title="View details">
                        <EyeIcon className="w-4 h-4" />
                      </button>
                      <button onClick={() => setConfirmDoc(doc)} className="text-gray-400 dark:text-gray-500 hover:text-red-600 p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors" title="Delete document">
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDoc}
        title="Delete document"
        message={confirmDoc ? `Permanently delete "${confirmDoc.original_filename}"? The file, thumbnail and extracted text will be removed.` : ''}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDoc(null)}
      />
    </div>
  );
}
