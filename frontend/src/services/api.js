import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Build an authenticated URL for media that the browser loads directly
// (<img>, new tab, download link) and that therefore cannot set a header.
export const mediaUrl = (path) => {
  const token = localStorage.getItem('token');
  const separator = path.includes('?') ? '&' : '?';
  return `/api${path}${separator}token=${encodeURIComponent(token || '')}`;
};

export default api;
