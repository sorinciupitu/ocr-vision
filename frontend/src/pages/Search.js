import React, { useState } from 'react';
import api, { mediaUrl } from '../services/api';
import {
  MagnifyingGlassIcon, ArrowTopRightOnSquareIcon, ArrowDownTrayIcon, PrinterIcon, EyeIcon
} from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import Thumbnail from '../components/Thumbnail';

export default function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const navigate = useNavigate();

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await api.get(`/documents/search?query=${encodeURIComponent(query)}`);
      setResults(res.data);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const openOriginal = (doc) => {
    window.open(mediaUrl(`/documents/${doc.id}/file?disposition=inline`), '_blank', 'noopener');
  };

  const downloadOriginal = (doc) => {
    const a = document.createElement('a');
    a.href = mediaUrl(`/documents/${doc.id}/file?disposition=attachment`);
    a.download = doc.original_filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const printDocument = (doc) => {
    window.open(`/document/${doc.id}/print`, '_blank', 'noopener');
  };

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-6">Search Documents</h2>
        <form onSubmit={handleSearch} className="flex gap-4">
          <div className="flex-1 relative">
            <MagnifyingGlassIcon className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
              placeholder="Search across all archived documents..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-primary-500 text-white font-medium rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-60"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {searched && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {results.length} Result{results.length !== 1 ? 's' : ''} found
          </h3>

          {results.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center text-gray-500">
              <MagnifyingGlassIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p>No matching documents found.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
              {results.map((r, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
                  <button
                    type="button"
                    onClick={() => navigate(`/document/${r.document.id}`)}
                    className="block w-full"
                  >
                    <Thumbnail document={r.document} className="w-full h-40 rounded-none border-b border-gray-100" />
                  </button>
                  <div className="p-4 flex flex-col flex-1">
                    <button
                      type="button"
                      onClick={() => navigate(`/document/${r.document.id}`)}
                      className="text-sm font-semibold text-gray-900 hover:text-primary-600 text-left truncate"
                      title={r.document.original_filename}
                    >
                      {r.document.original_filename}
                    </button>
                    <p className="text-xs text-gray-500 mt-1">
                      {format(new Date(r.document.created_at), 'PP')} • {r.document.file_type.toUpperCase()}
                    </p>
                    <div
                      className="text-xs text-gray-600 mt-3 line-clamp-3 bg-amber-50 rounded-lg p-3 border-l-4 border-amber-300"
                      dangerouslySetInnerHTML={{ __html: r.snippet }}
                    />
                    <div className="mt-auto pt-3 flex items-center justify-end space-x-1">
                      <button onClick={() => navigate(`/document/${r.document.id}`)} className="text-gray-400 hover:text-primary-600 p-1.5 rounded-full hover:bg-primary-50 transition-colors" title="View details">
                        <EyeIcon className="w-4 h-4" />
                      </button>
                      <button onClick={() => openOriginal(r.document)} className="text-gray-400 hover:text-primary-600 p-1.5 rounded-full hover:bg-primary-50 transition-colors" title="View original file">
                        <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                      </button>
                      <button onClick={() => downloadOriginal(r.document)} className="text-gray-400 hover:text-primary-600 p-1.5 rounded-full hover:bg-primary-50 transition-colors" title="Download">
                        <ArrowDownTrayIcon className="w-4 h-4" />
                      </button>
                      <button onClick={() => printDocument(r.document)} className="text-gray-400 hover:text-primary-600 p-1.5 rounded-full hover:bg-primary-50 transition-colors" title="Print">
                        <PrinterIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
