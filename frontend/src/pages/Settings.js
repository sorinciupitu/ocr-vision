import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  UsersIcon, ShieldCheckIcon, CheckIcon, XMarkIcon,
  EnvelopeIcon, KeyIcon, LockClosedIcon, LockOpenIcon, UserCircleIcon
} from '@heroicons/react/24/outline';
import api from '../services/api';
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
  const { user, refreshUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [toggling, setToggling] = useState(false);

  const isAdmin = !!(user && user.is_admin);

  const fetchAll = async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    try {
      const [usersRes, settingsRes] = await Promise.all([
        api.get('/admin/users'),
        api.get('/admin/settings'),
      ]);
      setUsers(usersRes.data);
      setRegistrationOpen(settingsRes.data.open);
    } catch (err) {
      toast.error('Failed to load settings');
    }
    setLoading(false);
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
