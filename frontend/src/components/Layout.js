import React, { Fragment, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Menu, Transition } from '@headlessui/react';
import {
  MagnifyingGlassIcon, DocumentPlusIcon, FolderArrowDownIcon,
  ArrowRightOnRectangleIcon, PlusIcon, ArrowUpTrayIcon, ChartBarIcon
} from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import ThemeToggle from './ThemeToggle';
import SearchOverlay from './SearchOverlay';

const navigation = [
  { name: 'Dashboard', href: '/', icon: DocumentPlusIcon },
  { name: 'Search', href: '/search', icon: MagnifyingGlassIcon },
  { name: 'Analytics', href: '/analytics', icon: ChartBarIcon },
  { name: 'Sync Folders', href: '/sync', icon: FolderArrowDownIcon },
];

const FOLDER_COLORS = ['bg-primary-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-sky-500', 'bg-violet-500'];

const PAGE_TITLES = { '/': 'Dashboard', '/search': 'Search', '/analytics': 'Analytics', '/sync': 'Sync Folders' };

function useQuery() {
  const { search } = useLocation();
  return new URLSearchParams(search);
}

function Layout() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [folders, setFolders] = useState([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const query = useQuery();
  const activeFolder = query.get('folder');
  const [dropTarget, setDropTarget] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);

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

  useEffect(fetchFolders, [location.pathname]);

  // Folder counts change on bulk moves, drops and organize actions anywhere
  // in the app; those all dispatch 'docs-changed'.
  useEffect(() => {
    const onDocsChanged = () => fetchFolders();
    window.addEventListener('docs-changed', onDocsChanged);
    return () => window.removeEventListener('docs-changed', onDocsChanged);
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

  const handleUpload = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setUploading(true);
    try {
      await api.post('/documents/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success(`Uploaded ${file.name}`);
      navigate('/');
    } catch (err) {
      toast.error(`Failed to upload ${file.name}`);
    }
    setUploading(false);
  };

  return (
    <div className="min-h-screen bg-[#f0f0f0] dark:bg-gray-950 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-gray-900 hidden md:flex flex-col border-r border-gray-100 dark:border-gray-800">
        <div className="h-20 flex items-center gap-3 px-6">
          <img src="/logo.png" alt="DocManager" className="h-9 w-9 object-contain" />
          <span className="text-lg font-extrabold tracking-tight text-gray-800 dark:text-gray-100">DocManager</span>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const active = location.pathname === item.href;
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                onClick={() => navigate(item.href)}
                className={`flex items-center w-full px-4 py-2.5 text-sm font-medium rounded-xl transition-colors ${
                  active
                    ? 'bg-primary-500 text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <Icon className="w-5 h-5 mr-3" />
                {item.name}
              </button>
            );
          })}

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
        </nav>

        <div className="p-4 border-t border-gray-100 dark:border-gray-800">
          <Menu as="div" className="relative">
            <Menu.Button className="flex items-center w-full px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary-500 text-white text-xs font-bold mr-2 flex-shrink-0">
                {user.username ? user.username.slice(0, 1).toUpperCase() : '?'}
              </span>
              <span className="flex-1 text-left truncate">{user.username}</span>
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
              <Menu.Items className="absolute right-0 bottom-full w-full mb-2 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 focus:outline-none overflow-hidden">
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
        <header className="h-20 bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-100 dark:border-gray-800 flex items-center justify-between px-6 md:px-10 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/logo.png" alt="DocManager" className="h-8 w-8 object-contain md:hidden" />
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate">{currentTitle}</h1>
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
            <button
              type="button"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              disabled={uploading}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-xl hover:bg-primary-600 transition-colors disabled:opacity-60"
            >
              <ArrowUpTrayIcon className="w-4 h-4 mr-2" />
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

        <main className="flex-1 p-6 md:p-10 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Floating action buttons */}
      <div className="fixed bottom-6 right-6 flex flex-col items-end space-y-3 z-40">
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

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

export default Layout;
