import React, { useState } from 'react';
import api from '../services/api';
import { MagnifyingGlassIcon, DocumentIcon } from '@heroicons/react/24/outline';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

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

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900 mb-6">Search Documents</h2>
        <form onSubmit={handleSearch} className="flex gap-4">
          <div className="flex-1 relative">
            <MagnifyingGlassIcon className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              type="text"
              className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              placeholder="Search across all archived documents..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors disabled:bg-indigo-300"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {searched && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-200">
            <h3 className="text-lg leading-6 font-medium text-gray-900">
              {results.length} Result{results.length !== 1 ? 's' : ''} found
            </h3>
          </div>
          <ul className="divide-y divide-gray-200">
            {results.map((r, i) => (
              <li key={i} className="p-6 hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/document/${r.document.id}`)}>
                <div className="flex items-start space-x-4">
                  <DocumentIcon className="h-8 w-8 text-gray-400 flex-shrink-0 mt-1" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-indigo-600">{r.document.original_filename}</p>
                    <p className="text-xs text-gray-500 mb-2">
                      {format(new Date(r.document.created_at), 'PPP')} | {r.document.file_type.toUpperCase()}
                    </p>
                    <div className="text-sm text-gray-600 line-clamp-3 bg-yellow-50 rounded-md p-3 border-l-4 border-yellow-300" 
                      dangerouslySetInnerHTML={{ __html: r.snippet }}
                    />
                  </div>
                </div>
              </li>
            ))}
            {results.length === 0 && (
              <li className="p-12 text-center text-gray-500">
                <MagnifyingGlassIcon className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p>No matching documents found.</p>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
