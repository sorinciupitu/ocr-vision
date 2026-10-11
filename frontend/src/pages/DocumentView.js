import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { mediaUrl } from '../services/api';
import {
  ClockIcon, ArrowTopRightOnSquareIcon, ArrowDownTrayIcon,
  PrinterIcon, ArrowPathIcon, TrashIcon, ArrowLeftIcon
} from '@heroicons/react/24/outline';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import Thumbnail from '../components/Thumbnail';
import ConfirmDialog from '../components/ConfirmDialog';

const statusStyle = {
  completed: 'bg-emerald-100 text-emerald-700',
  processing: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
  pending: 'bg-gray-100 text-gray-600',
};

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
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-primary-600 transition-colors"
      >
        <ArrowLeftIcon className="w-4 h-4 mr-1" />
        Back
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Preview + actions */}
        <div className="lg:col-span-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col">
          <Thumbnail document={doc} className="w-full h-64 rounded-xl" />
          <button
            onClick={openOriginal}
            className="mt-4 w-full inline-flex items-center justify-center px-4 py-2.5 text-sm font-medium text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors"
          >
            <ArrowTopRightOnSquareIcon className="w-4 h-4 mr-2" />
            Open original
          </button>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <button onClick={downloadOriginal} className="inline-flex flex-col items-center justify-center px-2 py-2.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors" title="Download">
              <ArrowDownTrayIcon className="w-5 h-5 mb-1" />
              Download
            </button>
            <button onClick={printDocument} className="inline-flex flex-col items-center justify-center px-2 py-2.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors" title="Print">
              <PrinterIcon className="w-5 h-5 mb-1" />
              Print
            </button>
            <button onClick={handleReprocess} disabled={busy} className="inline-flex flex-col items-center justify-center px-2 py-2.5 text-xs font-medium text-primary-700 bg-primary-50 rounded-xl hover:bg-primary-100 transition-colors disabled:opacity-50" title="Reprocess OCR">
              <ArrowPathIcon className={`w-5 h-5 mb-1 ${busy ? 'animate-spin' : ''}`} />
              Reprocess
            </button>
          </div>
        </div>

        {/* Details + text */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
            <h2 className="text-2xl font-bold text-gray-900 break-words">{doc.title}</h2>
            <p className="text-sm text-gray-500 mt-2">
              {format(new Date(doc.created_at), 'PPP')} | {doc.file_type.toUpperCase()} | {(doc.file_size / 1024 / 1024).toFixed(2)} MB | {doc.page_count} Pages
            </p>

            <div className="flex items-center justify-between mt-5">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-600">OCR Status:</span>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[doc.ocr_status] || statusStyle.pending}`}>
                  {doc.ocr_status}
                </span>
              </div>
              <button
                onClick={() => setConfirmOpen(true)}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-xl hover:bg-red-100 transition-colors"
              >
                <TrashIcon className="w-4 h-4 mr-2" />
                Delete
              </button>
            </div>
          </div>

          {doc.ocr_text && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Extracted Text</h3>
              <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 p-6 rounded-xl border border-gray-200 max-h-[600px] overflow-y-auto font-mono leading-relaxed">
                {doc.ocr_text}
              </pre>
            </div>
          )}
        </div>
      </div>

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
