import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import api, { mediaUrl } from '../services/api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import {
  CloudArrowUpIcon, EyeIcon, DocumentMagnifyingGlassIcon,
  ArrowPathIcon, TrashIcon, ArrowTopRightOnSquareIcon,
  FolderIcon, TagIcon, CheckIcon, SparklesIcon,
  Squares2X2Icon, TableCellsIcon, ListBulletIcon
} from '@heroicons/react/24/outline';
import { Menu } from '@headlessui/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Thumbnail from '../components/Thumbnail';
import ConfirmDialog from '../components/ConfirmDialog';
import OrganizeDialog, { tagColor } from '../components/OrganizeDialog';
import ContextMenu from '../components/ContextMenu';
import AutoTagRulesDialog from '../components/AutoTagRulesDialog';
import ProcessingQueue from '../components/ProcessingQueue';
import {
  enqueueUploadFiles,
  subscribeUploads,
  getUploadState,
  retryUpload,
  retryAllUploads,
  clearFinishedUploads,
  resolveDuplicates,
} from '../services/uploadQueue';

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
  const [queueDocuments, setQueueDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [tags, setTags] = useState([]);
  const [uploadState, setUploadState] = useState(getUploadState);
  const [viewMode, setViewModeState] = useState(() => {
    try { return localStorage.getItem('docview') || 'grid4'; } catch (e) { return 'grid4'; }
  });
  const [marquee, setMarquee] = useState(null);
  const marqueeStartRef = useRef(null);
  const marqueePosRef = useRef(null);
  const marqueeBaseRef = useRef(null);
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
  const [searchParams] = useSearchParams();
  const folderId = searchParams.get('folder');
  const tagId = searchParams.get('tag');

  const fetchDocuments = useCallback(async () => {
    try {
      const params = {};
      if (folderId) params.folder_id = folderId;
      if (tagId) params.tag_id = tagId;
      const [documentsRes, queueRes] = await Promise.all([
        api.get('/documents', { params }),
        api.get('/documents/queue'),
      ]);
      setDocuments(documentsRes.data);
      setQueueDocuments(queueRes.data || []);
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

  // The upload queue lives in a shared module store so the header/FAB
  // upload path behaves the same; this just mirrors it into the page.
  useEffect(() => subscribeUploads(() => setUploadState(getUploadState())), []);

  const { uploads: uploadQueue } = uploadState;
  const uploading = uploadQueue.some((u) => u.status === 'queued' || u.status === 'uploading');

  const uploadFiles = useCallback(
    (files) => enqueueUploadFiles(files, folderId),
    [folderId]
  );

  const setViewMode = (v) => {
    setViewModeState(v);
    try { localStorage.setItem('docview', v); } catch (e) { /* private mode */ }
  };

  const onDrop = useCallback((acceptedFiles) => uploadFiles(acceptedFiles), [uploadFiles]);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  const sortedDocuments = useMemo(() => {
    const list = [...documents];
    if (sortBy === 'name') list.sort((a, b) => a.original_filename.localeCompare(b.original_filename));
    else if (sortBy === 'status') list.sort((a, b) => a.ocr_status.localeCompare(b.ocr_status));
    else list.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
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

  const retryAllFailedDocs = async () => {
    const failed = documents.filter((d) => d.ocr_status === 'failed');
    if (!failed.length) return;
    let ok = 0;
    for (const d of failed) {
      try {
        await api.post(`/documents/${d.id}/retry`);
        ok += 1;
      } catch (err) {
        // Failures stay visible in the queue list after the refresh.
      }
    }
    toast.success(`Retrying ${ok} failed document${ok === 1 ? '' : 's'}`);
    fetchDocuments();
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

  // ---------- rubber-band selection ----------
  // Starts only from empty space (cards stay draggable to folders); Shift
  // extends the existing selection instead of replacing it.
  const onGridMouseDown = (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey) return;
    if (e.target.closest('[data-doc-card],button,a,input,select,textarea')) return;
    e.preventDefault();
    marqueeStartRef.current = { x: e.clientX, y: e.clientY };
    marqueePosRef.current = { x: e.clientX, y: e.clientY };
    marqueeBaseRef.current = e.shiftKey ? new Set(selectedIds) : null;
    setMarquee({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
  };

  const marqueeActive = !!marquee;
  useEffect(() => {
    if (!marqueeActive) return undefined;
    const onMove = (e) => {
      const start = marqueeStartRef.current;
      if (!start) return;
      marqueePosRef.current = { x: e.clientX, y: e.clientY };
      setMarquee((m) => (m ? { ...m, x2: e.clientX, y2: e.clientY } : m));
      // Below the threshold it is still a click, not a drag.
      if (Math.abs(e.clientX - start.x) < 4 && Math.abs(e.clientY - start.y) < 4) return;
      const rect = {
        left: Math.min(start.x, e.clientX),
        right: Math.max(start.x, e.clientX),
        top: Math.min(start.y, e.clientY),
        bottom: Math.max(start.y, e.clientY),
      };
      const next = marqueeBaseRef.current ? new Set(marqueeBaseRef.current) : new Set();
      document.querySelectorAll('[data-doc-card]').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.left < rect.right && b.right > rect.left && b.top < rect.bottom && b.bottom > rect.top) {
          next.add(el.getAttribute('data-doc-id'));
        }
      });
      setSelectedIds(next);
    };
    const onUp = () => {
      const start = marqueeStartRef.current;
      const pos = marqueePosRef.current;
      const moved = start && pos
        && (Math.abs(pos.x - start.x) >= 4 || Math.abs(pos.y - start.y) >= 4);
      const wasShift = !!marqueeBaseRef.current;
      setMarquee(null);
      marqueeStartRef.current = null;
      marqueePosRef.current = null;
      marqueeBaseRef.current = null;
      // A plain click on empty space clears the selection, as before.
      if (!moved && !wasShift) clearSelection();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [marqueeActive]);

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

  // Tag renames/colors and rule backfills change chips and card tags
  // without touching selection; refresh them as soon as they happen.
  useEffect(() => {
    const onTagsChanged = () => {
      fetchDocuments();
      fetchMeta();
    };
    window.addEventListener('tags-changed', onTagsChanged);
    return () => window.removeEventListener('tags-changed', onTagsChanged);
  }, [fetchDocuments]);

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

  // ---------- per-document building blocks (shared by the views) ----------
  const dragProps = {
    draggable: true,
    onDragStart: (e, doc) => {
      const ids = selectedIds.has(doc.id) ? [...selectedIds] : [doc.id];
      if (!selectedIds.has(doc.id)) setSelectedIds(new Set([doc.id]));
      e.dataTransfer.setData('application/x-doc-ids', JSON.stringify(ids));
      e.dataTransfer.setData('text/plain', JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'move';
    },
  };

  const selectBtn = (doc) => (
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
  );

  const metaText = (doc) =>
    `${format(new Date(doc.created_at), 'PP')} • ${(doc.file_size / 1024 / 1024).toFixed(2)} MB • ${doc.page_count} pg`;

  const tagsRow = (doc) =>
    (doc.folder || (doc.tags && doc.tags.length > 0)) ? (
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {doc.folder && (
          <span className="inline-flex items-center text-xs text-gray-500 dark:text-gray-400">
            <FolderIcon className="w-3.5 h-3.5 mr-1" />
            {doc.folder.name}
          </span>
        )}
        {(doc.tags || []).map((t) => (
          <span key={t.id} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${tagColor(t)}`}>
            {t.name}
          </span>
        ))}
      </div>
    ) : null;

  const statusPill = (doc) => (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle[doc.ocr_status] || statusStyle.pending}`}
      title={doc.ocr_error || statusLabel[doc.ocr_status] || doc.ocr_status}
    >
      {(doc.ocr_status === 'processing' || doc.ocr_status === 'pending') && (
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse mr-1.5" />
      )}
      {statusLabel[doc.ocr_status] || doc.ocr_status}
    </span>
  );

  const retryBadge = (doc) =>
    doc.ocr_status === 'failed' ? (
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
    ) : null;

  const actionBtns = (doc) => (
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
  );

  const docCardClass = (doc, extra = '') =>
    `${cardClass} relative hover:shadow-md transition-shadow overflow-hidden cursor-default ${extra} ${
      selectedIds.has(doc.id) ? 'ring-2 ring-primary-500' : ''
    }`;

  const renderCard = (doc) => {
    const dense = viewMode === 'grid8';
    return (
      <div
        key={doc.id}
        data-doc-card
        data-doc-id={doc.id}
        onClick={(e) => handleCardClick(e, doc)}
        onContextMenu={(e) => handleContextMenu(e, doc)}
        draggable
        onDragStart={(e) => dragProps.onDragStart(e, doc)}
        className={docCardClass(doc, 'flex flex-col')}
      >
        <button
          type="button"
          onClick={() => navigate(`/document/${doc.id}`)}
          className="block w-full"
        >
          <Thumbnail document={doc} className={`w-full ${dense ? 'h-24' : 'h-40'} rounded-none border-b border-gray-100 dark:border-gray-800`} />
        </button>
        {selectBtn(doc)}
        <div className={`${dense ? 'p-2.5' : 'p-4'} flex flex-col flex-1`}>
          <button
            type="button"
            onClick={() => navigate(`/document/${doc.id}`)}
            className={`${dense ? 'text-xs' : 'text-sm'} font-semibold text-gray-900 dark:text-gray-100 hover:text-primary-600 text-left truncate`}
            title={doc.original_filename}
          >
            {doc.original_filename}
          </button>
          <p className={`text-xs text-gray-500 dark:text-gray-400 ${dense ? 'mt-0.5' : 'mt-1'}`} title={metaText(doc)}>
            {dense ? `${(doc.file_size / 1024 / 1024).toFixed(1)} MB` : metaText(doc)}
          </p>
          {!dense && tagsRow(doc)}
          <div className={`flex items-center justify-between gap-2 ${dense ? 'mt-2' : 'mt-3 flex-wrap'}`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
              {statusPill(doc)}
              {retryBadge(doc)}
            </div>
            {actionBtns(doc)}
          </div>
        </div>
      </div>
    );
  };

  const renderListRow = (doc) => (
    <div
      key={doc.id}
      data-doc-card
      data-doc-id={doc.id}
      onClick={(e) => handleCardClick(e, doc)}
      onContextMenu={(e) => handleContextMenu(e, doc)}
      draggable
      onDragStart={(e) => dragProps.onDragStart(e, doc)}
      className={docCardClass(doc, 'flex items-center gap-4 px-4 py-2.5')}
    >
      {selectBtn(doc)}
      <button
        type="button"
        onClick={() => navigate(`/document/${doc.id}`)}
        className="flex-shrink-0 ml-4"
      >
        <Thumbnail document={doc} className="w-16 h-12" />
      </button>
      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={() => navigate(`/document/${doc.id}`)}
          className="text-sm font-semibold text-gray-900 dark:text-gray-100 hover:text-primary-600 text-left truncate block"
          title={doc.original_filename}
        >
          {doc.original_filename}
        </button>
        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
          {metaText(doc)}
          {doc.folder && ` • ${doc.folder.name}`}
          {(doc.tags || []).map((t) => ` #${t.name}`).join('')}
        </p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="flex items-center gap-x-2">
          {statusPill(doc)}
          {retryBadge(doc)}
        </div>
        {actionBtns(doc)}
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
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
        {uploading && <div className="mt-3 text-primary-600 font-medium animate-pulse">Uploading… see the queue below</div>}
      </div>

      <ProcessingQueue
        uploads={uploadQueue}
        documents={documents}
        queueDocuments={queueDocuments}
        busyId={busyId}
        onRetryUpload={retryUpload}
        onRetryAllUploads={retryAllUploads}
        onClearFinished={clearFinishedUploads}
        onRetryDoc={handleRetry}
        onReprocessDoc={handleReprocess}
        onRetryAllFailed={retryAllFailedDocs}
      />

      {/* Recent archives */}
      <div onMouseDown={onGridMouseDown}>
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
            <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-white dark:bg-gray-900">
              {[
                { id: 'grid4', icon: Squares2X2Icon, title: 'Grid · 4 columns' },
                { id: 'grid8', icon: TableCellsIcon, title: 'Grid · 8 columns' },
                { id: 'list', icon: ListBulletIcon, title: 'List' },
              ].map(({ id, icon: Icon, title }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setViewMode(id)}
                  title={title}
                  aria-pressed={viewMode === id}
                  className={`p-2 transition-colors ${
                    viewMode === id
                      ? 'bg-primary-500 text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
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
                      ? tagColor(t)
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
          <div
            className={
              viewMode === 'list'
                ? 'flex flex-col gap-2'
                : viewMode === 'grid8'
                  ? 'grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3'
                  : 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5'
            }
          >
            {sortedDocuments.map((doc) => (viewMode === 'list' ? renderListRow(doc) : renderCard(doc)))}
          </div>
        )}
      </div>

      {/* Selection action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-28 md:bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-2rem)] flex items-center gap-1.5 sm:gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg px-3 sm:px-4 py-2.5 overflow-x-auto">
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

      {marquee && (
        <div
          className="fixed z-30 pointer-events-none border border-primary-500 bg-primary-500/10"
          style={{
            left: Math.min(marquee.x1, marquee.x2),
            top: Math.min(marquee.y1, marquee.y2),
            width: Math.abs(marquee.x2 - marquee.x1),
            height: Math.abs(marquee.y2 - marquee.y1),
          }}
        />
      )}

      {/* Duplicate-file warning lives in Layout (shared by every upload path) */}

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
