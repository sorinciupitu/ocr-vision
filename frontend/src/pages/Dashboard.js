import React, { useCallback, useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import api, { mediaUrl } from '../services/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import {
  CloudArrowUpIcon, EyeIcon, DocumentMagnifyingGlassIcon,
  ArrowPathIcon, TrashIcon, ArrowTopRightOnSquareIcon
} from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import Thumbnail from '../components/Thumbnail';
import ConfirmDialog from '../components/ConfirmDialog';

const statusBadge = (status) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium 
    ${status === 'completed' ? 'bg-green-100 text-green-800' : 
      status === 'processing' ? 'bg-yellow-100 text-yellow-800' : 
      status === 'failed' ? 'bg-red-100 text-red-800' : 
      'bg-gray-100 text-gray-800'}`}>
    {status}
  </span>
);

export default function Dashboard() {
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [confirmDoc, setConfirmDoc] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

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

  const onDrop = useCallback(async (acceptedFiles) => {
    setUploading(true);
    for (const file of acceptedFiles) {
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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-6">Scan New Document</h2>
        
        <div 
          {...getRootProps()} 
          className={`flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            isDragActive ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-gray-400'
          }`}
        >
          <input {...getInputProps()} />
          <CloudArrowUpIcon className="w-12 h-12 text-gray-400 mb-4" />
          <p className="text-lg font-medium text-gray-700">
            {isDragActive ? "Drop the files here..." : "Drag & drop files here, or click to select"}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Supports PDF, DOCX, PNG, JPG, JPEG, TIFF (Max 50MB)
          </p>
          {uploading && <div className="mt-4 text-indigo-600 font-medium animate-pulse">Uploading...</div>}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-200">
          <h3 className="text-lg leading-6 font-medium text-gray-900">Recent Archives</h3>
        </div>
        
        <ul className="divide-y divide-gray-200">
          {documents.map((doc) => (
            <li key={doc.id} className="p-4 hover:bg-gray-50 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => navigate(`/document/${doc.id}`)}
                className="flex items-center space-x-4 min-w-0 flex-1 text-left"
              >
                <Thumbnail document={doc} className="w-14 h-14" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-indigo-600 truncate">{doc.original_filename}</p>
                  <p className="text-xs text-gray-500">
                    {format(new Date(doc.created_at), 'PPP')} • {(doc.file_size / 1024 / 1024).toFixed(2)} MB • {doc.page_count} Pages
                  </p>
                </div>
              </button>
              <div className="flex items-center space-x-1 flex-shrink-0">
                {statusBadge(doc.ocr_status)}
                <button
                  onClick={() => openOriginal(doc)}
                  className="text-gray-400 hover:text-indigo-600 p-2 rounded-full hover:bg-indigo-50 transition-colors"
                  title="View original file"
                >
                  <ArrowTopRightOnSquareIcon className="w-5 h-5" />
                </button>
                <button
                  onClick={() => handleReprocess(doc)}
                  disabled={busyId === doc.id}
                  className="text-gray-400 hover:text-indigo-600 p-2 rounded-full hover:bg-indigo-50 transition-colors disabled:opacity-50"
                  title="Reprocess OCR"
                >
                  <ArrowPathIcon className={`w-5 h-5 ${busyId === doc.id ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => navigate(`/document/${doc.id}`)}
                  className="text-gray-400 hover:text-indigo-600 p-2 rounded-full hover:bg-indigo-50 transition-colors"
                  title="View Details"
                >
                  <EyeIcon className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setConfirmDoc(doc)}
                  className="text-gray-400 hover:text-red-600 p-2 rounded-full hover:bg-red-50 transition-colors"
                  title="Delete document"
                >
                  <TrashIcon className="w-5 h-5" />
                </button>
              </div>
            </li>
          ))}
          {documents.length === 0 && (
            <li className="p-12 text-center text-gray-500">
              <DocumentMagnifyingGlassIcon className="w-12 h-12 mx-auto text-gray-400 mb-3" />
              <p>No documents archived yet.</p>
            </li>
          )}
        </ul>
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
