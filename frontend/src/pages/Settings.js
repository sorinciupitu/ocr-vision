import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  UsersIcon, ShieldCheckIcon, CheckIcon, XMarkIcon,
  EnvelopeIcon, KeyIcon, LockClosedIcon, LockOpenIcon, UserCircleIcon,
  ArrowDownTrayIcon, ArrowUpTrayIcon, ArchiveBoxIcon,
  CpuChipIcon, CommandLineIcon, ArrowPathIcon
} from '@heroicons/react/24/outline';
import api, { mediaUrl } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const cardClass = 'bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm';
const inputClass = 'px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm w-full';

function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-700'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function EditUserDialog({ user, onClose, onSaved, currentUserId }) {
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [isActive, setIsActive] = useState(user.is_active);
  const [isAdmin, setIsAdmin] = useState(user.is_admin);
  const [saving, setSaving] = useState(false);
  const isSelf = user.id === currentUserId;

  const save = async (e) => {
    e.preventDefault();
    const payload = {};
    if (username !== user.username) payload.username = username.trim();
    if (email !== user.email) payload.email = email.trim();
    if (password) payload.password = password;
    if (isActive !== user.is_active) payload.is_active = isActive;
    if (isAdmin !== user.is_admin) payload.is_admin = isAdmin;
    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/admin/users/${user.id}`, payload);
      toast.success(`Updated ${user.username}`);
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update user');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={save}
        className={`${cardClass} relative w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Edit user</h3>
          <button type="button" onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
          <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
          <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            New password <span className="text-gray-400 font-normal">(leave empty to keep current)</span>
          </label>
          <input type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-gray-700 dark:text-gray-300">Active account</span>
          <Toggle checked={isActive} onChange={setIsActive} disabled={isSelf} label="Active account" />
        </div>
        {isSelf && (
          <p className="text-xs text-gray-400 dark:text-gray-500 -mt-2">You cannot deactivate your own account.</p>
        )}
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-gray-700 dark:text-gray-300">Administrator</span>
          <Toggle checked={isAdmin} onChange={setIsAdmin} disabled={isSelf} label="Administrator" />
        </div>
        {isSelf && (
          <p className="text-xs text-gray-400 dark:text-gray-500 -mt-2">You cannot change your own admin role.</p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-xl disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function Settings() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const [backupInfo, setBackupInfo] = useState(null);
  const [llm, setLlm] = useState({ provider: 'ollama', base_url: '', model: '', api_key: '' });
  const [logs, setLogs] = useState([]);
  const [savingLlm, setSavingLlm] = useState(false);
  const importInputRef = useRef(null);

  const isAdmin = !!(user && user.is_admin);

  const fetchAll = async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    try {
      const [usersRes, settingsRes, backupRes, llmRes, logsRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/settings'),
        api.get('/admin/backup/info'),
        api.get('/admin/llm'),
        api.get('/admin/logs?limit=200'),
      ]);
      setUsers(usersRes.data);
      setRegistrationOpen(settingsRes.data.open);
      setBackupInfo(backupRes.data);
      setLlm({ ...llmRes.data, api_key: '' });
      setLogs(logsRes.data.logs || []);
    } catch (err) {
      toast.error('Failed to load settings');
    }
    setLoading(false);
  };

  const saveLlm = async (event) => {
    event.preventDefault();
    setSavingLlm(true);
    try {
      const payload = { provider: llm.provider, base_url: llm.base_url, model: llm.model };
      if (llm.api_key) payload.api_key = llm.api_key;
      const res = await api.put('/admin/llm', payload);
      setLlm({ ...res.data, api_key: '' });
      toast.success('LLM settings saved');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save LLM settings');
    } finally {
      setSavingLlm(false);
    }
  };

  const refreshLogs = async () => {
    try { setLogs((await api.get('/admin/logs?limit=200')).data.logs || []); } catch (err) { toast.error('Failed to load logs'); }
  };

  const clearLogs = async () => {
    try { await api.delete('/admin/logs'); setLogs([]); } catch (err) { toast.error('Failed to clear logs'); }
  };

  useEffect(() => { fetchAll(); }, [isAdmin]);

  const toggleRegistration = async (open) => {
    setToggling(true);
    try {
      await api.put('/admin/settings/registration', { open });
      setRegistrationOpen(open);
      toast.success(open ? 'Registration enabled' : 'Registration disabled');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to update setting');
    }
    setToggling(false);
  };

  const exportArchive = async (kind) => {
    setExporting(true);
    setExportStatus('Preparing archive…');
    try {
      const res = await api.post('/admin/backup/export', { kind });
      const { job_id: jobId, parts } = res.data;
      // Parts are fetched one by one as plain links (?token= auth) so the
      // browser streams them straight to disk instead of buffering in RAM.
      for (let i = 0; i < parts.length; i += 1) {
        setExportStatus(`Downloading part ${i + 1} of ${parts.length}…`);
        const link = document.createElement('a');
        link.href = mediaUrl(`/admin/backup/export/${jobId}/${encodeURIComponent(parts[i].name)}`);
        link.download = parts[i].name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        if (i < parts.length - 1) {
          // Small gap so the browser queues the downloads instead of dropping some.
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
      }
      toast.success(
        parts.length > 1
          ? `Backup exported as ${parts.length} parts — select all of them when importing`
          : 'Backup downloaded'
      );
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Export failed', { duration: 8000 });
    }
    setExporting(false);
    setExportStatus('');
  };

  const importArchive = async (fileList) => {
    const parts = Array.from(fileList).sort((a, b) => a.name.localeCompare(b.name));
    const confirmed = window.confirm(
      `Importing ${parts.length} archive part(s) REPLACES ALL data on this server `
      + '(users, documents, folders, tags, settings) with the archive contents. '
      + 'For a database-only archive the original files must already be in the files folder. '
      + 'This cannot be undone. Continue?'
    );
    if (!confirmed) return;
    setImporting(true);
    try {
      const form = new FormData();
      parts.forEach((f) => form.append('files', f));
      const res = await api.post('/admin/backup/import', form);
      const counts = res.data?.imported || {};
      toast.success(
        `Archive imported: ${counts.documents ?? 0} documents, ${counts.users ?? 0} users`
      );
      // The archive replaced all accounts, so the current session may be gone.
      logout();
      navigate('/login');
    } catch (err) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === 'string' ? detail : 'Import failed', { duration: 12000 });
    }
    setImporting(false);
  };

  if (!isAdmin) {
    return (
      <div className={`${cardClass} p-16 text-center text-gray-500 dark:text-gray-400`}>
        <LockClosedIcon className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
        <p>Settings are available to administrators only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* LLM / document chat */}
      <div className={`${cardClass} p-6 md:p-8`}>
        <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-1"><CpuChipIcon className="w-5 h-5 text-primary-500" /> AI chat &amp; LLM</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Configurează Ollama sau orice endpoint OpenAI-compatible. Chat-ul folosește textul OCR al documentelor tale.</p>
        <form onSubmit={saveLlm} className="grid md:grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Provider</label><select className={inputClass} value={llm.provider} onChange={(e) => { const provider = e.target.value; const isVllm = provider === 'vllm'; setLlm({ ...llm, provider, base_url: isVllm ? 'http://vllm:8000/v1/chat/completions' : llm.base_url, model: isVllm ? 'lightonai/LightOnOCR-3-4B' : (llm.model || (provider === 'ollama' ? 'llama3.2' : '')) }); }}><option value="ollama">Ollama</option><option value="openai">OpenAI-compatible</option><option value="vllm">vLLM (OCR model — preset)</option></select></div>
          <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Model name</label><input className={inputClass} value={llm.model || ''} onChange={(e) => setLlm({ ...llm, model: e.target.value })} placeholder="llama3.2" required readOnly={llm.provider === 'vllm'} /></div>
          <div className="md:col-span-2"><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Endpoint URL</label><input className={inputClass} value={llm.base_url || ''} onChange={(e) => setLlm({ ...llm, base_url: e.target.value })} placeholder="http://host.docker.internal:11434/v1/chat/completions" readOnly={llm.provider === 'vllm'} /><p className="text-xs text-gray-400 mt-1">Presetul vLLM folosește endpoint-ul intern al serviciului și modelul OCR deja încărcat.</p></div>
          <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API key {llm.api_key_set && <span className="text-emerald-600">(set)</span>}</label><input type="password" className={inputClass} value={llm.api_key || ''} onChange={(e) => setLlm({ ...llm, api_key: e.target.value })} placeholder={llm.api_key_set ? 'Leave empty to keep current key' : 'Optional'} autoComplete="new-password" /></div>
          <div className="flex items-end"><button type="submit" disabled={savingLlm} className="px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-medium disabled:opacity-60">{savingLlm ? 'Saving…' : 'Save LLM settings'}</button></div>
        </form>
      </div>

      {/* Runtime log console */}
      <div className={`${cardClass} p-6 md:p-8`}>
        <div className="flex items-center justify-between gap-3 mb-1"><h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2"><CommandLineIcon className="w-5 h-5 text-primary-500" /> Runtime console</h2><div className="flex gap-2"><button onClick={refreshLogs} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" title="Refresh logs"><ArrowPathIcon className="w-4 h-4" /></button><button onClick={clearLogs} className="px-3 py-1.5 text-xs rounded-lg text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800">Clear</button></div></div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Ultimele erori și mesaje ale serverului, inclusiv traceback-ul upload-urilor eșuate.</p>
        <pre className="max-h-80 overflow-auto rounded-xl bg-gray-950 text-gray-200 p-4 text-xs leading-5 whitespace-pre-wrap">{logs.length ? logs.map((log) => `[${log.timestamp}] ${log.level} ${log.logger}: ${log.message}`).join('\n') : 'No runtime logs yet.'}</pre>
      </div>

      {/* Registration toggle */}
      <div className={`${cardClass} p-6 md:p-8`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
              {registrationOpen ? <LockOpenIcon className="w-5 h-5 text-emerald-500" /> : <LockClosedIcon className="w-5 h-5 text-red-500" />}
              User registration
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {registrationOpen
                ? 'Anyone with the app URL can create an account.'
                : 'Registration is closed. Only existing accounts can sign in.'}
            </p>
          </div>
          <Toggle
            checked={registrationOpen}
            onChange={toggleRegistration}
            disabled={toggling}
            label="User registration"
          />
        </div>
      </div>

      {/* Backup & restore */}
      <div className={`${cardClass} p-6 md:p-8`}>
        <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-1">
          <ArchiveBoxIcon className="w-5 h-5 text-primary-500" />
          Backup &amp; restore
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          Export everything (users, documents, OCR text, folders, tags, files) as a ZIP split
          into parts{backupInfo ? ` of up to ${backupInfo.part_size_mb} MB` : ''}, export only
          the database, or restore an exported archive on this or another server.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => exportArchive('full')}
            disabled={exporting || importing}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 rounded-xl disabled:opacity-60"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            {exporting ? 'Preparing…' : 'Export (with files)'}
          </button>
          <button
            onClick={() => exportArchive('database')}
            disabled={exporting || importing}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl disabled:opacity-60"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
            {exporting ? 'Preparing…' : 'Export (DB only)'}
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={exporting || importing}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-xl disabled:opacity-60"
          >
            <ArrowUpTrayIcon className="w-4 h-4" />
            {importing ? 'Importing…' : 'Import archive'}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".zip,application/zip"
            multiple
            className="hidden"
            onChange={(e) => {
              const selected = Array.from(e.target.files || []);
              e.target.value = '';
              if (selected.length) importArchive(selected);
            }}
          />
        </div>
        {exporting && exportStatus && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">{exportStatus}</p>
        )}
        {backupInfo && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 leading-5">
            Import needs every part of the archive — select all exported <code>.zip</code>{' '}
            parts together. For a database-only archive, copy the original files into{' '}
            <code className="break-all">{backupInfo.upload_folder}</code>{' '}
            <em>before</em> importing (flat, or one subfolder per document id); if any file
            is missing the import is refused and nothing is changed.
          </p>
        )}
        {importing && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
            Restoring the archive — keep this tab open until it finishes.
          </p>
        )}
      </div>

      {/* Users */}
      <div className={`${cardClass} p-6 md:p-8`}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-primary-500" />
            Registered users
          </h2>
          <span className="text-sm text-gray-400 dark:text-gray-500">{users.length} total</span>
        </div>

        {loading ? (
          <p className="text-gray-400 animate-pulse">Loading users…</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {users.map((u) => (
              <li key={u.id} className="py-4 flex flex-wrap items-center gap-3 md:gap-4">
                <span className="flex items-center justify-center w-10 h-10 rounded-full bg-primary-500 text-white text-sm font-bold flex-shrink-0">
                  {u.username ? u.username.slice(0, 1).toUpperCase() : '?'}
                </span>
                <div className="flex-1 min-w-[150px]">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <span className="truncate">{u.username}</span>
                    {u.id === user.id && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">you</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 truncate">
                    <EnvelopeIcon className="w-3.5 h-3.5 flex-shrink-0" />
                    {u.email}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {u.is_admin && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300">
                      <ShieldCheckIcon className="w-3.5 h-3.5" />
                      Admin
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                      u.is_active
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300'
                    }`}
                  >
                    {u.is_active ? 'Active' : 'Disabled'}
                  </span>
                  <button
                    onClick={() => setEditing(u)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                  >
                    Edit
                  </button>
                </div>
              </li>
            ))}
            {users.length === 0 && (
              <li className="py-8 text-center text-gray-400 dark:text-gray-500">
                <UserCircleIcon className="w-10 h-10 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                No users found.
              </li>
            )}
          </ul>
        )}
      </div>

      {editing && (
        <EditUserDialog
          user={editing}
          currentUserId={user.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            fetchAll();
            if (editing.id === user.id && refreshUser) refreshUser();
          }}
        />
      )}
    </div>
  );
}
