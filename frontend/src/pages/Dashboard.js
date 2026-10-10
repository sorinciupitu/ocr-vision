import React, { useCallback, useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import api from '../services/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { CloudArrowUpIcon, DocumentIcon,  EyeIcon, DocumentMagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
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
            <li key={doc.id} className="p-6 hover:bg-gray-50 flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <DocumentIcon className="h-10 w-10 text-gray-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-indigo-600 truncate">{doc.original_filename}</p>
                  <p className="text-xs text-gray-500">
                    {format(new Date(doc.created_at), 'PPP')} • {(doc.file_size / 1024 / 1024).toFixed(2)} MB • {doc.page_count} Pages
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium 
                  ${doc.ocr_status === 'completed' ? 'bg-green-100 text-green-800' : 
                    doc.ocr_status === 'processing' ? 'bg-yellow-100 text-yellow-800' : 
                    doc.ocr_status === 'failed' ? 'bg-red-100 text-red-800' : 
                    'bg-gray-100 text-gray-800'}`}>
                  {doc.ocr_status}
                </span>
                <button
                  onClick={() => navigate(`/document/${doc.id}`)}
                  className="text-gray-400 hover:text-indigo-600 p-2 rounded-full hover:bg-indigo-50 transition-colors"
                  title="View Details"
                >
                  <EyeIcon className="w-5 h-5" />
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
    </div>
  );
}
