import React, { Fragment, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Menu, Transition } from '@headlessui/react';
import {
  MagnifyingGlassIcon, DocumentPlusIcon, FolderArrowDownIcon, QueueListIcon,
  ArrowRightOnRectangleIcon, PlusIcon, ArrowUpTrayIcon, ChartBarIcon,
  Cog6ToothIcon, CpuChipIcon, ChevronDoubleLeftIcon, ChevronDoubleRightIcon,
  FolderIcon, HomeIcon, PencilIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import ThemeToggle from './ThemeToggle';
import SearchOverlay from './SearchOverlay';
import DuplicateDialog from './DuplicateDialog';
import TagEditDialog from './TagEditDialog';
import { tagDot } from './OrganizeDialog';
import {
  enqueueUploadFiles,
  subscribeUploads,
  getUploadState,
  resolveDuplicates,
} from '../services/uploadQueue';

const navigation = [
  { name: 'Dashboard', href: '/', icon: DocumentPlusIcon },
  { name: 'AI Chat', href: '/chat', icon: CpuChipIcon },
  { name: 'Search', href: '/search', icon: MagnifyingGlassIcon },
  { name: 'Analytics', href: '/analytics', icon: ChartBarIcon },
  { name: 'Sync Folders', href: '/sync', icon: FolderArrowDownIcon },
  { name: 'Settings', href: '/settings', icon: Cog6ToothIcon },
];

// Bottom bar on phones keeps every sidebar destination one tap away.
const mobileNav = [
  { name: 'Home', href: '/', icon: HomeIcon },
  { name: 'Search', href: '/search', icon: MagnifyingGlassIcon },
  { name: 'Sync', href: '/sync', icon: FolderArrowDownIcon },
  { name: 'Analytics', href: '/analytics', icon: ChartBarIcon },
  { name: 'Settings', href: '/settings', icon: Cog6ToothIcon },
];

const FOLDER_COLORS = ['bg-primary-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-sky-500', 'bg-violet-500'];

const PAGE_TITLES = {
  '/': 'Dashboard', '/chat': 'AI Chat', '/search': 'Search', '/analytics': 'Analytics',
  '/sync': 'Sync Folders', '/settings': 'Settings',
};

function useQuery() {
  const { search } = useLocation();
  return new URLSearchParams(search);
}

function Layout() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef(null);
  const [uploadState, setUploadState] = useState(getUploadState);
  const [queueDocuments, setQueueDocuments] = useState([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [folders, setFolders] = useState([]);
  const [tags, setTags] = useState([]);
  const [editingTag, setEditingTag] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const query = useQuery();
  const activeFolder = query.get('folder');
  const activeTag = query.get('tag');
  const [dropTarget, setDropTarget] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true');
  const [foldersSheetOpen, setFoldersSheetOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', collapsed ? 'true' : 'false');
  }, [collapsed]);

  // Mirror the shared upload queue: it drives the header button's busy
  // state and the duplicate-file dialog shown on every page.
  useEffect(() => subscribeUploads(() => setUploadState(getUploadState())), []);

  // Keep a global view of server-side OCR work. The Dashboard has the full
  // queue controls; this compact panel keeps activity visible on every page.
  useEffect(() => {
    let alive = true;
    const fetchQueueDocuments = () => {
      api.get('/documents', { params: { limit: 100 } })
        .then((res) => { if (alive) setQueueDocuments(res.data || []); })
        .catch(() => {});
    };
    fetchQueueDocuments();
    const interval = setInterval(fetchQueueDocuments, 5000);
    const refresh = () => fetchQueueDocuments();
    window.addEventListener('docs-changed', refresh);
    return () => {
      alive = false;
      clearInterval(interval);
      window.removeEventListener('docs-changed', refresh);
    };
  }, []);

  const uploading = uploadState.uploads.some(
    (u) => u.status === 'queued' || u.status === 'uploading'
  );
  const queueUploads = uploadState.uploads.filter((u) => u.status !== 'done');
  const queueDocs = queueDocuments.filter((d) => ['pending', 'processing', 'failed'].includes(d.ocr_status));
  const queueCount = queueUploads.length + queueDocs.length;

  // Global shortcut: Cmd/Ctrl+K toggles the search overlay, like vite.dev.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fetchFolders = () => {
    api.get('/folders').then((r) => setFolders(r.data)).catch(() => {});
  };

  const fetchTags = () => {
    api.get('/tags').then((r) => setTags(r.data)).catch(() => {});
  };

  useEffect(() => {
    fetchFolders();
    fetchTags();
  }, [location.pathname]);

  // Folder counts, tag counts and the tag list change on moves, deletes and
  // tag/rule edits anywhere in the app; those announce 'docs-changed' or
  // 'tags-changed'.
  useEffect(() => {
    const refresh = () => {
      fetchFolders();
      fetchTags();
    };
    window.addEventListener('docs-changed', refresh);
    window.addEventListener('tags-changed', refresh);
    return () => {
      window.removeEventListener('docs-changed', refresh);
      window.removeEventListener('tags-changed', refresh);
    };
  }, []);

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    try {
      const res = await api.post('/folders', { name });
      setNewFolderName('');
      toast.success(`Folder "${res.data.name}" created`);
      fetchFolders();
      setFoldersSheetOpen(false);
      navigate(`/?folder=${res.data.id}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to create folder');
    }
    setCreatingFolder(false);
  };

  // Drop documents (dragged from the dashboard) into a sidebar folder.
  const handleDrop = async (e, folderId) => {
    e.preventDefault();
    setDropTarget(null);
    const raw =
      e.dataTransfer.getData('application/x-doc-ids') || e.dataTransfer.getData('text/plain');
    if (!raw) return;
    let ids;
    try {
      ids = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(ids) || ids.length === 0) return;
    try {
      await api.post('/documents/bulk-folder', { document_ids: ids, folder_id: folderId });
      toast.success(`Moved ${ids.length} document${ids.length > 1 ? 's' : ''}${folderId ? ' to folder' : ''}`);
      window.dispatchEvent(new CustomEvent('docs-changed'));
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to move documents');
    }
  };

  const dropProps = (key) => ({
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget(key);
    },
    onDragLeave: () => setDropTarget((cur) => (cur === key ? null : cur)),
    onDrop: (e) => handleDrop(e, key === 'all' ? null : key),
  });

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-500 dark:text-gray-400 bg-[#f0f0f0] dark:bg-gray-950">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  const activeFolderObj = activeFolder && folders.find((f) => f.id === activeFolder);
  const currentTitle =
    (location.pathname === '/' && activeFolderObj && activeFolderObj.name) ||
    PAGE_TITLES[location.pathname] || 'Document';

  const handleUpload = (e) => {
    // Copy the FileList before resetting the input: clearing value empties
    // the live list the handler still holds.
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    // Same queue as the dashboard dropzone: per-file progress, retries and
    // the duplicate-name dialog.
    enqueueUploadFiles(files, activeFolder || null);
    navigate('/');
  };

  const goFolder = (id) => {
    setFoldersSheetOpen(false);
    navigate(id ? `/?folder=${id}` : '/');
  };

  const goTag = (id) => {
    setFoldersSheetOpen(false);
    navigate(`/?tag=${id}`);
  };

  return (
    <div className="min-h-screen bg-[#f0f0f0] dark:bg-gray-950 flex">
      {/* Sidebar (desktop only); collapses to icons */}
      <aside
        className={`${
          collapsed ? 'w-20' : 'w-64'
        } bg-white dark:bg-gray-900 hidden md:flex flex-col border-r border-gray-100 dark:border-gray-800 transition-[width] duration-200 ease-out flex-shrink-0`}
      >
        <div className={`h-20 flex items-center gap-3 ${collapsed ? 'justify-center px-2' : 'px-6'}`}>
          <img src="/logo.png" alt="DocManager" className="h-9 w-9 object-contain flex-shrink-0" />
          {!collapsed && (
            <span className="text-lg font-extrabold tracking-tight text-gray-800 dark:text-gray-100">DocManager</span>
          )}
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const active = location.pathname === item.href;
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                onClick={() => navigate(item.href)}
                title={collapsed ? item.name : undefined}
                className={`flex items-center w-full ${collapsed ? 'justify-center px-0 py-2.5' : 'px-4 py-2.5'} text-sm font-medium rounded-xl transition-colors ${
                  active
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <Icon className={`w-5 h-5 ${collapsed ? '' : 'mr-3'}`} />
                {!collapsed && item.name}
              </button>
            );
          })}

          {!collapsed ? (
            <div className="pt-6">
              <div className="flex items-center justify-between px-4 mb-2">
                <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Folders</p>
                <button
                  onClick={() => navigate('/')}
                  {...dropProps('all')}
                  className={`text-xs font-medium transition-colors rounded px-1 ${
                    !activeFolder ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 hover:text-primary-600 dark:hover:text-primary-400'
                  } ${dropTarget === 'all' ? 'ring-2 ring-primary-400 bg-primary-50 dark:bg-primary-500/10' : ''}`}
                  title="Show all documents (or drop documents here to unfile them)"
                >
                  All
                </button>
              </div>
              {folders.map((f, i) => (
                <button
                  key={f.id}
                  onClick={() => navigate(`/?folder=${f.id}`)}
                  {...dropProps(f.id)}
                  className={`flex items-center justify-between w-full px-4 py-2 text-sm rounded-xl transition-colors ${
                    activeFolder === f.id
                      ? 'bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 font-medium'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  } ${
                    dropTarget === f.id
                      ? 'ring-2 ring-primary-400 bg-primary-50 dark:bg-primary-500/10'
                      : ''
                  }`}
                >
                  <span className="flex items-center min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full mr-3 flex-shrink-0 ${FOLDER_COLORS[i % FOLDER_COLORS.length]}`} />
                    <span className="truncate">{f.name}</span>
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500 ml-2 flex-shrink-0">{f.document_count}</span>
                </button>
              ))}
              {folders.length === 0 && (
                <p className="px-4 py-2 text-sm text-gray-400 dark:text-gray-500">No folders yet</p>
              )}
              <div className="flex gap-2 px-4 mt-2">
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createFolder()}
                  placeholder="New folder..."
                  className="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <button
                  onClick={createFolder}
                  disabled={creatingFolder || !newFolderName.trim()}
                  className="p-1.5 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50"
                  title="Create folder"
                >
                  <PlusIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="pt-6 space-y-2">
              <button
                onClick={() => navigate('/')}
                title="All documents"
                className={`flex items-center justify-center w-full py-2 rounded-xl transition-colors ${
                  !activeFolder
                    ? 'text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-500/10'
                    : 'text-gray-400 hover:text-primary-600 dark:hover:text-primary-400'
                }`}
              >
                <FolderIcon className="w-4 h-4" />
              </button>
              {folders.map((f, i) => (
                <button
                  key={f.id}
                  onClick={() => navigate(`/?folder=${f.id}`)}
                  title={`${f.name} (${f.document_count})`}
                  className={`flex items-center justify-center w-full py-2 rounded-xl transition-colors ${
                    activeFolder === f.id
                      ? 'bg-primary-50 dark:bg-primary-500/10'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${FOLDER_COLORS[i % FOLDER_COLORS.length]}`} />
                </button>
              ))}
            </div>
          )}

          {/* Tags: click filters, pencil edits name/color/rules */}
          {!collapsed ? (
            <div className="pt-6">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-4 mb-2">
                Tags
              </p>
              {tags.map((t) => (
                <div
                  key={t.id}
                  className={`group flex items-center rounded-xl transition-colors ${
                    activeTag === t.id
                      ? 'bg-primary-50 dark:bg-primary-500/10'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <button
                    onClick={() => navigate(`/?tag=${t.id}`)}
                    className={`flex flex-1 min-w-0 items-center justify-between px-4 py-2 text-sm rounded-xl transition-colors ${
                      activeTag === t.id
                        ? 'text-primary-700 dark:text-primary-300 font-medium'
                        : 'text-gray-600 dark:text-gray-300'
                    }`}
                    title={`Filter by #${t.name}`}
                  >
                    <span className="flex items-center min-w-0">
                      <span className={`w-2.5 h-2.5 rounded-full mr-3 flex-shrink-0 ${tagDot(t)}`} />
                      <span className="truncate">{t.name}</span>
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-2 flex-shrink-0">{t.document_count}</span>
                  </button>
                  <button
                    onClick={() => setEditingTag(t)}
                    title={`Edit "${t.name}"`}
                    className="mr-2 p-1 rounded-lg text-gray-400 opacity-0 group-hover:opacity-100 hover:text-primary-600 hover:bg-white dark:hover:bg-gray-900 transition-opacity flex-shrink-0"
                  >
                    <PencilIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {tags.length === 0 && (
                <p className="px-4 py-2 text-sm text-gray-400 dark:text-gray-500">No tags yet</p>
              )}
            </div>
          ) : (
            <div className="pt-6 space-y-2">
              {tags.map((t) => (
                <button
                  key={t.id}
                  onClick={() => navigate(`/?tag=${t.id}`)}
                  title={`${t.name} (${t.document_count})`}
                  className={`flex items-center justify-center w-full py-2 rounded-xl transition-colors ${
                    activeTag === t.id
                      ? 'bg-primary-50 dark:bg-primary-500/10'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 rounded-full ${tagDot(t)}`} />
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="p-3 border-t border-gray-100 dark:border-gray-800 space-y-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden md:flex items-center justify-center w-full py-2 text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl transition-colors"
          >
            {collapsed ? <ChevronDoubleRightIcon className="w-4 h-4" /> : (
              <>
                <ChevronDoubleLeftIcon className="w-4 h-4 mr-2" />
                Collapse
              </>
            )}
          </button>
          <Menu as="div" className="relative">
            <Menu.Button
              title={collapsed ? `${user.username} — menu` : undefined}
              className={`flex items-center w-full px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 ${collapsed ? 'justify-center px-0' : ''}`}
            >
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary-500 text-white text-xs font-bold flex-shrink-0">
                {user.username ? user.username.slice(0, 1).toUpperCase() : '?'}
              </span>
              {!collapsed && <span className="flex-1 text-left truncate ml-2">{user.username}</span>}
            </Menu.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Menu.Items className={`absolute bottom-full mb-2 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 focus:outline-none overflow-hidden ${
                collapsed ? 'left-1/2 -translate-x-1/2 w-44' : 'right-0 w-full'
              }`}>
                <Menu.Item>
                  {({ active }) => (
                    <button
                      onClick={() => navigate('/settings')}
                      className={`${active ? 'bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200'} flex items-center w-full px-4 py-2.5 text-sm`}
                    >
                      <Cog6ToothIcon className="w-4 h-4 mr-2" />
                      Settings
                    </button>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <button
                      onClick={logout}
                      className={`${active ? 'bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200'} flex items-center w-full px-4 py-2.5 text-sm`}
                    >
                      <ArrowRightOnRectangleIcon className="w-4 h-4 mr-2" />
                      Sign out
                    </button>
                  )}
                </Menu.Item>
              </Menu.Items>
            </Transition>
          </Menu>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-20 bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-100 dark:border-gray-800 flex items-center justify-between px-4 sm:px-6 md:px-10 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/logo.png" alt="DocManager" className="h-8 w-8 object-contain md:hidden" />
            <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100 truncate">{currentTitle}</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="hidden md:inline-flex items-center gap-2 px-3 py-2 text-sm text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="Search documents (Ctrl/⌘ + K)"
            >
              <MagnifyingGlassIcon className="w-4 h-4" />
              <span>Search…</span>
              <kbd className="inline-flex items-center justify-center min-w-[18px] px-1 py-0.5 text-[10px] font-medium bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded">⌘K</kbd>
            </button>
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="md:hidden p-2 text-gray-500 dark:text-gray-400 hover:text-primary-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Search"
            >
              <MagnifyingGlassIcon className="w-6 h-6" />
            </button>
            {/* Account menu on phones, where the sidebar is hidden */}
            <div className="md:hidden">
              <Menu as="div" className="relative">
                <Menu.Button className="flex items-center justify-center w-9 h-9 rounded-full bg-primary-500 text-white text-xs font-bold">
                  {user.username ? user.username.slice(0, 1).toUpperCase() : '?'}
                </Menu.Button>
                <Transition
                  as={Fragment}
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <Menu.Items className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 focus:outline-none overflow-hidden z-50">
                    <div className="px-4 py-2.5 text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700 truncate">
                      {user.username}
                    </div>
                    <Menu.Item>
                      {({ active }) => (
                        <button
                          onClick={() => navigate('/settings')}
                          className={`${active ? 'bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200'} flex items-center w-full px-4 py-2.5 text-sm`}
                        >
                          <Cog6ToothIcon className="w-4 h-4 mr-2" />
                          Settings
                        </button>
                      )}
                    </Menu.Item>
                    <Menu.Item>
                      {({ active }) => (
                        <button
                          onClick={logout}
                          className={`${active ? 'bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200'} flex items-center w-full px-4 py-2.5 text-sm`}
                        >
                          <ArrowRightOnRectangleIcon className="w-4 h-4 mr-2" />
                          Sign out
                        </button>
                      )}
                    </Menu.Item>
                  </Menu.Items>
                </Transition>
              </Menu>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              disabled={uploading}
              className="inline-flex items-center px-3 sm:px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-60"
            >
              <ArrowUpTrayIcon className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">{uploading ? 'Uploading...' : 'Upload'}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.docx"
              className="hidden"
              onChange={handleUpload}
            />
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 md:p-10 pb-28 md:pb-10 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Floating action buttons (desktop; phones use header + bottom bar) */}
      <div className="fixed bottom-6 right-6 hidden md:flex flex-col items-end space-y-3 z-40">
        {queueOpen && (
          <div className="w-[min(92vw,28rem)] max-h-[min(70vh,34rem)] overflow-y-auto rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl p-4 text-left">
            <div className="flex items-center justify-between mb-3">
              <div><h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Processing queue</h3><p className="text-xs text-gray-500 dark:text-gray-400">Se actualizează automat</p></div>
              <button type="button" onClick={() => navigate('/')} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Dashboard</button>
            </div>
            {queueUploads.length > 0 && <div className="mb-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Upload</p>{queueUploads.map((u) => <div key={u.id} className="flex items-center gap-2 py-1 text-sm"><span className={`w-2 h-2 rounded-full flex-shrink-0 ${u.status === 'error' ? 'bg-red-500' : 'bg-primary-500 animate-pulse'}`} /><span className="truncate flex-1 text-gray-800 dark:text-gray-200" title={u.error || u.name}>{u.name}</span><span className="text-xs text-gray-400">{u.status === 'uploading' ? `${u.progress}%` : u.status === 'error' ? 'failed' : 'queued'}</span></div>)}</div>}
            {queueDocs.length > 0 && <div><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">OCR processing</p>{queueDocs.map((d) => <div key={d.id} className="flex items-center gap-2 py-1 text-sm"><span className={`w-2 h-2 rounded-full flex-shrink-0 ${d.ocr_status === 'failed' ? 'bg-red-500' : 'bg-amber-500 animate-pulse'}`} /><span className="truncate flex-1 text-gray-800 dark:text-gray-200" title={d.ocr_error || d.original_filename}>{d.original_filename}</span><span className="text-xs text-gray-400">{d.ocr_status === 'processing' ? 'processing' : d.ocr_status}</span></div>)}</div>}
            {queueCount === 0 && <p className="text-sm text-gray-400 dark:text-gray-500">Nothing in the queue.</p>}
          </div>
        )}
        <button
          type="button"
          onClick={() => setQueueOpen((open) => !open)}
          className="relative w-12 h-12 rounded-full bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-gray-700 flex items-center justify-center transition-colors"
          title="Show upload and OCR processing queue"
        >
          <QueueListIcon className="w-6 h-6" />
          {queueCount > 0 && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{queueCount}</span>}
        </button>
        <button
          type="button"
          onClick={() => navigate('/chat')}
          className="w-12 h-12 rounded-full bg-primary-500 text-white shadow-lg hover:bg-primary-600 flex items-center justify-center transition-colors"
          title="Chat with your documents"
        >
          <CpuChipIcon className="w-6 h-6" />
        </button>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="w-12 h-12 rounded-full bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-gray-700 flex items-center justify-center transition-colors"
          title="Search documents (Ctrl/⌘ + K)"
        >
          <MagnifyingGlassIcon className="w-6 h-6" />
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
          disabled={uploading}
          className="w-14 h-14 rounded-full bg-primary-500 text-white shadow-lg hover:bg-primary-600 flex items-center justify-center transition-colors disabled:opacity-60"
          title="Add new document"
        >
          <PlusIcon className={`w-7 h-7 ${uploading ? 'animate-pulse' : ''}`} />
        </button>
      </div>

      {/* Bottom navigation (phones only) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 flex items-stretch pb-[env(safe-area-inset-bottom)]">
        {mobileNav.map((item) => {
          const active = location.pathname === item.href;
          const Icon = item.icon;
          return (
            <button
              key={item.name}
              onClick={() => navigate(item.href)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 text-[10px] font-medium transition-colors ${
                active
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              {item.name}
            </button>
          );
        })}
        <button
          onClick={() => setFoldersSheetOpen(true)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1.5 text-[10px] font-medium transition-colors ${
            activeFolder || foldersSheetOpen
              ? 'text-primary-600 dark:text-primary-400'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          <FolderIcon className="w-5 h-5" />
          Folders
        </button>
      </nav>

      {/* Folders bottom sheet (phones only) */}
      {foldersSheetOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setFoldersSheetOpen(false)}
          />
          <div className="absolute bottom-0 inset-x-0 bg-white dark:bg-gray-900 rounded-t-2xl border-t border-gray-100 dark:border-gray-800 p-4 pb-8 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">Folders</h3>
              <button
                onClick={() => setFoldersSheetOpen(false)}
                className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-2 py-1"
              >
                Close
              </button>
            </div>
            <button
              onClick={() => goFolder(null)}
              className={`flex items-center justify-between w-full px-4 py-3 text-sm rounded-xl transition-colors mb-1 ${
                !activeFolder
                  ? 'bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 font-medium'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <span className="flex items-center">
                <FolderIcon className="w-4 h-4 mr-3" />
                All documents
              </span>
              <span className="text-xs text-gray-400">{folders.reduce((n, f) => n + (f.document_count || 0), 0)}</span>
            </button>
            {folders.map((f, i) => (
              <button
                key={f.id}
                onClick={() => goFolder(f.id)}
                className={`flex items-center justify-between w-full px-4 py-3 text-sm rounded-xl transition-colors mb-1 ${
                  activeFolder === f.id
                    ? 'bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <span className="flex items-center min-w-0">
                  <span className={`w-2.5 h-2.5 rounded-full mr-3 flex-shrink-0 ${FOLDER_COLORS[i % FOLDER_COLORS.length]}`} />
                  <span className="truncate">{f.name}</span>
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500 ml-2 flex-shrink-0">{f.document_count}</span>
              </button>
            ))}
            {folders.length === 0 && (
              <p className="px-4 py-2 text-sm text-gray-400 dark:text-gray-500">No folders yet</p>
            )}
            {tags.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                <p className="px-4 pb-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Tags</p>
                {tags.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => goTag(t.id)}
                    className={`flex items-center justify-between w-full px-4 py-3 text-sm rounded-xl transition-colors mb-1 ${
                      activeTag === t.id
                        ? 'bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 font-medium'
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span className="flex items-center min-w-0">
                      <span className={`w-2.5 h-2.5 rounded-full mr-3 flex-shrink-0 ${tagDot(t)}`} />
                      <span className="truncate">{t.name}</span>
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 ml-2 flex-shrink-0">{t.document_count}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createFolder()}
                placeholder="New folder..."
                className="flex-1 min-w-0 text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                onClick={createFolder}
                disabled={creatingFolder || !newFolderName.trim()}
                className="px-3 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50"
                title="Create folder"
              >
                <PlusIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />

      {uploadState.dupDialog && (
        <DuplicateDialog
          names={uploadState.dupDialog.names}
          onChoose={resolveDuplicates}
        />
      )}

      {editingTag && (
        <TagEditDialog tag={editingTag} onClose={() => setEditingTag(null)} />
      )}
    </div>
  );
}

export default Layout;
