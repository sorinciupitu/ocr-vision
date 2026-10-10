import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../services/api';
import { DocumentIcon, ClockIcon } from '@heroicons/react/24/outline';
import { format } from 'date-fns';

export default function DocumentView() {
  const { id } = useParams();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDoc = async () => {
      try {
        const res = await api.get(`/documents/${id}`);
        setDoc(res.data);
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    };
    fetchDoc();
  }, [id]);

  if (loading) return <div className="flex items-center justify-center p-20"><ClockIcon className="w-8 h-8 animate-spin text-gray-400" /></div>;
  if (!doc) return <div className="text-center p-20 text-gray-500">Document not found.</div>;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="flex items-center space-x-4 mb-6">
          <DocumentIcon className="h-10 w-10 text-indigo-500" />
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{doc.title}</h2>
            <p className="text-sm text-gray-500">
              {format(new Date(doc.created_at), 'PPP')} | {doc.file_type.toUpperCase()} | {(doc.file_size / 1024 / 1024).toFixed(2)} MB | {doc.page_count} Pages
            </p>
          </div>
        </div>

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
      </div>

      {doc.ocr_text && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Extracted Text</h3>
          <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 p-6 rounded-lg border border-gray-200 max-h-[600px] overflow-y-auto font-mono leading-relaxed">
            {doc.ocr_text}
          </pre>
        </div>
      )}
    </div>
  );
}
