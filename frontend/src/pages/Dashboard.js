import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import api, { mediaUrl } from '../services/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import {
  CloudArrowUpIcon, EyeIcon, DocumentMagnifyingGlassIcon,
  ArrowPathIcon, TrashIcon, ArrowTopRightOnSquareIcon,
  MagnifyingGlassIcon, FolderArrowDownIcon, ArrowUpTrayIcon,
  FolderIcon, TagIcon, CheckIcon, SparklesIcon
} from '@heroicons/react/24/outline';
import { Menu } from '@headlessui/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Thumbnail from '../components/Thumbnail';
import ConfirmDialog from '../components/ConfirmDialog';
import OrganizeDialog, { tagColor } from '../components/OrganizeDialog';
import ContextMenu from '../components/ContextMenu';
import AutoTagRulesDialog from '../components/AutoTagRulesDialog';

const statusStyle = {
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  processing: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  pending: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

const statusLabel = {
  completed: 'Completed',
  processing: 'Processing…',
  failed: 'Failed',
  pending: 'Queued',
};

export default function Dashboard() {
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [tags, setTags] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [confirmDoc, setConfirmDoc] = useState(null);
  const [organizeDoc, setOrganizeDoc] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const lastClickedRef = useRef(null);
  const [deleting, setDeleting] = useState(false);
  const [sortBy, setSortBy] = useState('recent');
  const navigate = useNavigate();
  const heroInputRef = useRef(null);
  const [searchParams] = useSearchParams();
  const folderId = searchParams.get('folder');
  const tagId = searchParams.get('tag');

  const fetchDocuments = useCallback(async () => {
    try {
      const params = {};
      if (folderId) params.folder_id = folderId;
      if (tagId) params.tag_id = tagId;
      const res = await api.get('/documents', { params });
      setDocuments(res.data);
    } catch (err) {
      toast.error("Failed to load documents");
    }
  }, [folderId, tagId]);

  const fetchMeta = () => {
    api.get('/folders').then((r) => setFolders(r.data)).catch(() => {});
    api.get('/tags').then((r) => setTags(r.data)).catch(() => {});
  };

  useEffect(() => {
    fetchDocuments();
    const interval = setInterval(fetchDocuments, 5000);
    return () => clearInterval(interval);
  }, [fetchDocuments]);

  useEffect(() => {
    fetchMeta();
  }, []);

  const uploadFiles = useCallback(async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      if (folderId) formData.append('folder_id', folderId);
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
    window.dispatchEvent(new CustomEvent('docs-changed'));
  }, [folderId, fetchDocuments]);

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

  const handleRetry = async (doc) => {
    setBusyId(doc.id);
    try {
      await api.post(`/documents/${doc.id}/retry`);
      toast.success(`Retrying ${doc.original_filename}`);
      fetchDocuments();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to retry document');
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
      fetchMeta();
    } catch (err) {
      toast.error('Failed to delete document');
    }
    setDeleting(false);
  };

  const handleOrganizeChanged = () => {
    window.dispatchEvent(new CustomEvent('docs-changed'));
    if (organizeDoc) {
      api.get(`/documents/${organizeDoc.id}`).then((r) => setOrganizeDoc(r.data)).catch(() => {});
    }
  };

  const openOriginal = (doc) => {
    window.open(mediaUrl(`/documents/${doc.id}/file?disposition=inline`), '_blank', 'noopener');
  };

  // ---------- multi-selection ----------
  const clearSelection = () => setSelectedIds(new Set());

  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
    lastClickedRef.current = id;
  };

  const handleCardClick = (e, doc) => {
    if (e.target.closest('button')) return;
    if (e.shiftKey && lastClickedRef.current) {
      const ids = sortedDocuments.map((d) => d.id);
      const a = ids.indexOf(lastClickedRef.current);
      const b = ids.indexOf(doc.id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedIds(new Set(ids.slice(lo, hi + 1)));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      toggleSelect(doc.id);
      return;
    }
    lastClickedRef.current = null;
    if (selectedIds.size) clearSelection();
  };

  const handleContextMenu = (e, doc) => {
    e.preventDefault();
    if (!selectedIds.has(doc.id)) {
      setSelectedIds(new Set([doc.id]));
      lastClickedRef.current = doc.id;
    }
    setContextMenu({ x: e.clientX, y: e.clientY, doc });
  };

  // ---------- bulk operations ----------
  const bulkMove = async (ids, folderId) => {
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      await api.post('/documents/bulk-folder', { document_ids: ids, folder_id: folderId });
      toast.success(`Moved ${ids.length} document${ids.length > 1 ? 's' : ''}`);
      window.dispatchEvent(new CustomEvent('docs-changed'));
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to move documents');
    }
    setBulkBusy(false);
  };

  const bulkAddTags = async (ids, tagIds) => {
    if (!ids.length) return;
    try {
      await api.post('/documents/bulk-tags', { document_ids: ids, tag_ids: tagIds });
      toast.success(`Tagged ${ids.length} document${ids.length > 1 ? 's' : ''}`);
      // Keep the selection: the user may want to add more tags.
      fetchDocuments();
      fetchMeta();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to tag documents');
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setDeleting(true);
    try {
      const res = await api.post('/documents/bulk-delete', { document_ids: ids });
      toast.success(`Deleted ${res.data.deleted} document${res.data.deleted === 1 ? '' : 's'}`);
      setConfirmBulk(false);
      window.dispatchEvent(new CustomEvent('docs-changed'));
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete documents');
    }
    setDeleting(false);
  };

  // Sidebar drops (and other views) announce changes here.
  useEffect(() => {
    const onDocsChanged = () => {
      fetchDocuments();
      fetchMeta();
      clearSelection();
    };
    window.addEventListener('docs-changed', onDocsChanged);
    return () => window.removeEventListener('docs-changed', onDocsChanged);
  }, [fetchDocuments]);

  const quickActions = [
    { label: 'Upload documents', desc: 'Add PDFs or images to the archive', icon: ArrowUpTrayIcon, onClick: () => heroInputRef.current && heroInputRef.current.click() },
    { label: 'Search archive', desc: 'Full-text search across OCR text', icon: MagnifyingGlassIcon, onClick: () => navigate('/search') },
    { label: 'Sync folders', desc: 'Index files from a local directory', icon: FolderArrowDownIcon, onClick: () => navigate('/sync') },
  ];

  const cardClass = 'bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm';
  const iconBtn = 'text-gray-400 dark:text-gray-500 hover:text-primary-600 p-1.5 rounded-full hover:bg-primary-50 dark:hover:bg-gray-800 transition-colors';

  const contextItems = contextMenu
    ? [
        { label: 'Open', icon: EyeIcon, onClick: () => navigate(`/document/${contextMenu.doc.id}`) },
        { label: 'View original', icon: ArrowTopRightOnSquareIcon, onClick: () => openOriginal(contextMenu.doc) },
        { label: 'Organize…', icon: FolderIcon, onClick: () => setOrganizeDoc(contextMenu.doc) },
        { divider: true },
        { header: `Move ${selectedIds.size || 1} to folder` },
        ...folders.map((f) => ({
          label: f.name,
          icon: FolderIcon,
          onClick: () => bulkMove([...selectedIds], f.id),
        })),
        { label: 'No folder', icon: FolderIcon, onClick: () => bulkMove([...selectedIds], null) },
        { divider: true },
        {
          label: 'Select all',
          icon: CheckIcon,
          onClick: () => setSelectedIds(new Set(sortedDocuments.map((d) => d.id))),
        },
        { label: 'Clear selection', onClick: clearSelection },
      ]
    : [];

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
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {folderId && folders.find((f) => f.id === folderId)
              ? folders.find((f) => f.id === folderId).name
              : 'Recent Archives'}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRules(true)}
              className="inline-flex items-center gap-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
              title="Manage auto-tagging rules"
            >
              <SparklesIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Auto-tag rules</span>
            </button>
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
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <TagIcon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            {tags.map((t) => {
              const active = tagId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    const params = new URLSearchParams(searchParams);
                    if (active) params.delete('tag');
                    else params.set('tag', t.id);
                    navigate({ search: params.toString() ? `?${params}` : '' });
                  }}
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    active
                      ? tagColor(t.name)
                      : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                  title={active ? 'Clear tag filter' : `Filter by #${t.name}`}
                >
                  {t.name}
                  <span className={`ml-1.5 ${active ? 'opacity-70' : 'text-gray-400 dark:text-gray-500'}`}>{t.document_count}</span>
                </button>
              );
            })}
            {(folderId || tagId) && (
              <button
                onClick={() => navigate('/')}
                className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline ml-1"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {sortedDocuments.length === 0 ? (
          <div className={`${cardClass} p-16 text-center text-gray-500 dark:text-gray-400`}>
            <DocumentMagnifyingGlassIcon className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
            <p>{folderId || tagId ? 'No documents match this filter.' : 'No documents archived yet.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            {sortedDocuments.map((doc) => (
              <div
                key={doc.id}
                onClick={(e) => handleCardClick(e, doc)}
                onContextMenu={(e) => handleContextMenu(e, doc)}
                draggable
                onDragStart={(e) => {
                  const ids = selectedIds.has(doc.id) ? [...selectedIds] : [doc.id];
                  if (!selectedIds.has(doc.id)) setSelectedIds(new Set([doc.id]));
                  e.dataTransfer.setData('application/x-doc-ids', JSON.stringify(ids));
                  e.dataTransfer.setData('text/plain', JSON.stringify(ids));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                className={`${cardClass} relative hover:shadow-md transition-shadow overflow-hidden flex flex-col cursor-default ${
                  selectedIds.has(doc.id) ? 'ring-2 ring-primary-500' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => navigate(`/document/${doc.id}`)}
                  className="block w-full"
                >
                  <Thumbnail document={doc} className="w-full h-40 rounded-none border-b border-gray-100 dark:border-gray-800" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(doc.id);
                  }}
                  className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                    selectedIds.has(doc.id)
                      ? 'bg-primary-500 border-primary-500 text-white'
                      : 'bg-white/90 dark:bg-gray-800/90 border-gray-300 dark:border-gray-600 text-transparent hover:border-primary-500'
                  }`}
                  title={selectedIds.has(doc.id) ? 'Deselect' : 'Select'}
                >
                  <CheckIcon className="w-4 h-4" />
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
                  {(doc.folder || (doc.tags && doc.tags.length > 0)) && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {doc.folder && (
                        <span className="inline-flex items-center text-xs text-gray-500 dark:text-gray-400">
                          <FolderIcon className="w-3.5 h-3.5 mr-1" />
                          {doc.folder.name}
                        </span>
                      )}
                      {(doc.tags || []).map((t) => (
                        <span key={t.id} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${tagColor(t.name)}`}>
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[doc.ocr_status] || statusStyle.pending}`}
                        title={doc.ocr_error || statusLabel[doc.ocr_status] || doc.ocr_status}
                      >
                        {(doc.ocr_status === 'processing' || doc.ocr_status === 'pending') && (
                          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-1.5" />
                        )}
                        {statusLabel[doc.ocr_status] || doc.ocr_status}
                      </span>
                      {doc.ocr_status === 'failed' && (
                        <button
                          type="button"
                          onClick={() => handleRetry(doc)}
                          disabled={busyId === doc.id}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                          title={doc.ocr_error || 'Retry OCR'}
                        >
                          <ArrowPathIcon className={`w-3.5 h-3.5 ${busyId === doc.id ? 'animate-spin' : ''}`} />
                          Retry
                        </button>
                      )}
                    </div>
                    <div className="flex items-center space-x-1">
                      <button onClick={() => setOrganizeDoc(doc)} className={iconBtn} title="Move to folder / tags">
                        <FolderIcon className="w-4 h-4" />
                      </button>
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

      {/* Selection action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 sm:gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg px-4 py-2.5">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 mr-1">
            {selectedIds.size} selected
          </span>
          <Menu as="div" className="relative">
            <Menu.Button
              disabled={bulkBusy}
              className="px-3 py-1.5 text-sm font-medium rounded-xl bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50"
            >
              Move to folder
            </Menu.Button>
            <Menu.Items className="absolute bottom-full left-0 mb-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 py-1 focus:outline-none">
              <Menu.Item>
                {({ active }) => (
                  <button
                    onClick={() => bulkMove([...selectedIds], null)}
                    className={`${active ? 'bg-gray-50 dark:bg-gray-700' : ''} w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2`}
                  >
                    <FolderIcon className="w-4 h-4 flex-shrink-0" />
                    No folder
                  </button>
                )}
              </Menu.Item>
              {folders.map((f) => (
                <Menu.Item key={f.id}>
                  {({ active }) => (
                    <button
                      onClick={() => bulkMove([...selectedIds], f.id)}
                      className={`${active ? 'bg-gray-50 dark:bg-gray-700' : ''} w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2`}
                    >
                      <FolderIcon className="w-4 h-4 flex-shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </button>
                  )}
                </Menu.Item>
              ))}
            </Menu.Items>
          </Menu>
          <Menu as="div" className="relative">
            <Menu.Button className="px-3 py-1.5 text-sm font-medium rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700">
              Add tags
            </Menu.Button>
            <Menu.Items className="absolute bottom-full left-0 mb-2 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 py-1 focus:outline-none">
              {tags.length === 0 && (
                <div className="px-3 py-2 text-sm text-gray-400">No tags yet</div>
              )}
              {tags.map((t) => (
                <Menu.Item key={t.id}>
                  {({ active }) => (
                    <button
                      onClick={() => bulkAddTags([...selectedIds], [t.id])}
                      className={`${active ? 'bg-gray-50 dark:bg-gray-700' : ''} w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200`}
                    >
                      {t.name}
                    </button>
                  )}
                </Menu.Item>
              ))}
            </Menu.Items>
          </Menu>
          <button
            onClick={() => setConfirmBulk(true)}
            className="px-3 py-1.5 text-sm font-medium rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
          >
            Delete
          </button>
          <button
            onClick={clearSelection}
            className="px-3 py-1.5 text-sm font-medium rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Clear
          </button>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDoc}
        title="Delete document"
        message={confirmDoc ? `Permanently delete "${confirmDoc.original_filename}"? The file, thumbnail and extracted text will be removed.` : ''}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDoc(null)}
      />

      <ConfirmDialog
        open={confirmBulk}
        title="Delete documents"
        message={selectedIds.size ? `Permanently delete ${selectedIds.size} selected document(s)? Files, thumbnails and extracted text will be removed.` : ''}
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmBulk(false)}
      />

      {showRules && (
        <AutoTagRulesDialog
          tags={tags}
          onClose={() => setShowRules(false)}
          onChanged={() => {
            fetchDocuments();
            fetchMeta();
          }}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {organizeDoc && (
        <OrganizeDialog
          doc={organizeDoc}
          folders={folders}
          tags={tags}
          onClose={() => setOrganizeDoc(null)}
          onChanged={handleOrganizeChanged}
        />
      )}
    </div>
  );
}
