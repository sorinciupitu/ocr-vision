import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { mediaUrl } from '../services/api';
import {
  DocumentIcon, ClockIcon, ArrowTopRightOnSquareIcon, ArrowDownTrayIcon,
  PrinterIcon, ArrowPathIcon, TrashIcon
} from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import Thumbnail from '../components/Thumbnail';
import ConfirmDialog from '../components/ConfirmDialog';

export default function DocumentView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fetchDoc = async () => {
    try {
      const res = await api.get(`/documents/${id}`);
      setDoc(res.data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchDoc(); }, [id]);

  if (loading) return <div className="flex items-center justify-center p-20"><ClockIcon className="w-8 h-8 animate-spin text-gray-400" /></div>;
  if (!doc) return <div className="text-center p-20 text-gray-500">Document not found.</div>;

  const openOriginal = () => {
    window.open(mediaUrl(`/documents/${doc.id}/file?disposition=inline`), '_blank', 'noopener');
  };

  const downloadOriginal = () => {
    const a = document.createElement('a');
    a.href = mediaUrl(`/documents/${doc.id}/file?disposition=attachment`);
    a.download = doc.original_filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const printDocument = () => {
    window.open(`/document/${doc.id}/print`, '_blank', 'noopener');
  };

  const handleReprocess = async () => {
    setBusy(true);
    try {
      await api.post(`/documents/${doc.id}/reprocess`);
      toast.success('Reprocessing document');
      await fetchDoc();
    } catch (err) {
      toast.error('Failed to reprocess document');
    }
    setBusy(false);
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await api.delete(`/documents/${doc.id}`);
      toast.success('Document deleted');
      navigate('/');
    } catch (err) {
      toast.error('Failed to delete document');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex flex-col sm:flex-row sm:items-start gap-6">
          <Thumbnail document={doc} className="w-32 h-44" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-3 mb-2">
              <DocumentIcon className="h-8 w-8 text-indigo-500 flex-shrink-0" />
              <h2 className="text-2xl font-bold text-gray-900 truncate">{doc.title}</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              {format(new Date(doc.created_at), 'PPP')} | {doc.file_type.toUpperCase()} | {(doc.file_size / 1024 / 1024).toFixed(2)} MB | {doc.page_count} Pages
            </p>

            <div className="flex items-center space-x-2 mb-6">
              <span className="text-sm font-medium text-gray-600">OCR Status:</span>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium 
                ${doc.ocr_status === 'completed' ? 'bg-green-100 text-green-800' : 
                  doc.ocr_status === 'processing' ? 'bg-yellow-100 text-yellow-800' : 
                  doc.ocr_status === 'failed' ? 'bg-red-100 text-red-800' : 
                  'bg-gray-100 text-gray-800'}`}>
                {doc.ocr_status}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={openOriginal}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <ArrowTopRightOnSquareIcon className="w-4 h-4 mr-2" />
                Open original
              </button>
              <button
                onClick={downloadOriginal}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
                Download
              </button>
              <button
                onClick={printDocument}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <PrinterIcon className="w-4 h-4 mr-2" />
                Print
              </button>
              <button
                onClick={handleReprocess}
                disabled={busy}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors disabled:opacity-50"
              >
                <ArrowPathIcon className={`w-4 h-4 mr-2 ${busy ? 'animate-spin' : ''}`} />
                Reprocess
              </button>
              <button
                onClick={() => setConfirmOpen(true)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
              >
                <TrashIcon className="w-4 h-4 mr-2" />
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {doc.ocr_text && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Extracted Text</h3>
          <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 p-6 rounded-lg border border-gray-200 max-h-[600px] overflow-y-auto font-mono leading-relaxed">
            {doc.ocr_text}
          </pre>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete document"
        message={`Permanently delete "${doc.original_filename}"? The file, thumbnail and extracted text will be removed.`}
        confirmLabel="Delete"
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
