import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api, { mediaUrl } from '../services/api';

const IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'tiff', 'bmp', 'webp'];

export default function PrintView() {
  const { id } = useParams();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(false);
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    api.get(`/documents/${id}`)
      .then((res) => setDoc(res.data))
      .catch(() => setError(true));
  }, [id]);

  useEffect(() => {
    if (doc && !printed) {
      const timer = setTimeout(() => window.print(), 500);
      setPrinted(true);
      return () => clearTimeout(timer);
    }
  }, [doc, printed]);

  if (error) return <div className="p-8 text-center text-gray-500">Document not found.</div>;
  if (!doc) return <div className="p-8 text-center text-gray-500">Loading...</div>;

  const fileUrl = mediaUrl(`/documents/${doc.id}/file?disposition=inline`);
  const isPdf = doc.file_type === 'pdf';
  const isImage = IMAGE_TYPES.includes(doc.file_type);

  return (
    <div className="p-8 bg-white text-gray-900">
      <div className="mb-4">
        <h1 className="text-xl font-bold">{doc.title}</h1>
        <p className="text-sm text-gray-500">
          {doc.file_type.toUpperCase()} • {doc.page_count} page(s)
        </p>
      </div>

      {isPdf && (
        <iframe
          title={doc.title}
          src={fileUrl}
          className="w-full border border-gray-200 mb-6"
          style={{ height: '960px' }}
        />
      )}
      {isImage && (
        <img src={fileUrl} alt={doc.title} className="max-w-full mb-6 border border-gray-200" />
      )}

      {doc.ocr_text && (
        <div>
          <h2 className="text-lg font-semibold mb-2">Extracted Text</h2>
          <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed">{doc.ocr_text}</pre>
        </div>
      )}
    </div>
  );
}
