import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Pull the canonical user (incl. is_admin/is_active) from the server so the
  // UI never runs on a stale localStorage copy.
  const refreshUser = useCallback(async (token) => {
    try {
      const res = await api.get('/auth/me', token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
      const me = res.data;
      localStorage.setItem('user', JSON.stringify(me));
      setUser(me);
      return me;
    } catch (err) {
      // 401/403 means the token is dead or the account was disabled.
      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
      }
      return null;
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token) {
      if (savedUser) {
        try {
          setUser(JSON.parse(savedUser));
        } catch {
          localStorage.removeItem('user');
        }
      }
      refreshUser(token).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [refreshUser]);

  const login = async (username, password) => {
    const formData = new FormData();
    formData.append('username', username);
    formData.append('password', password);
    const res = await api.post('/auth/login', formData);
    localStorage.setItem('token', res.data.access_token);
    const me = await refreshUser(res.data.access_token);
    if (!me) {
      const fallback = { username };
      localStorage.setItem('user', JSON.stringify(fallback));
      setUser(fallback);
    }
    return res.data;
  };

  const register = async (username, email, password) => {
    await api.post('/auth/register', { username, email, password });
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
