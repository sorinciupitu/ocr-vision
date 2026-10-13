import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import ThemeToggle from '../components/ThemeToggle';
import api from '../services/api';

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [registrationOpen, setRegistrationOpen] = useState(true);

  const { login, register } = useAuth();
  const navigate = useNavigate();

  // Public endpoint: hide the sign-up option when admins closed registration.
  useEffect(() => {
    api.get('/auth/registration-status')
      .then((r) => setRegistrationOpen(r.data.open))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (isLogin) {
        await login(username, password);
        toast.success("Welcome back!");
        navigate('/');
      } else {
        await register(username, email, password);
        toast.success("Registration successful, please login.");
        setIsLogin(true);
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "An error occurred");
    }
  };

  const inputClass = 'mt-1 block w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:bg-white dark:focus:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm';

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-500 to-primary-700 py-12 px-4 sm:px-6 lg:px-8">
      <div className="absolute top-4 right-4">
        <ThemeToggle className="text-white/80 hover:bg-white/10 hover:text-white" />
      </div>
      <div className="max-w-md w-full bg-white dark:bg-gray-900 p-10 rounded-3xl shadow-xl">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="DocManager" className="h-16 w-16 object-contain mb-4" />
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight">DocManager</h1>
          <h2 className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {isLogin ? 'Sign in to your account' : 'Create an account'}
          </h2>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Username</label>
            <input
              name="username"
              type="text"
              required
              className={inputClass}
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email address</label>
              <input
                name="email"
                type="email"
                required
                className={inputClass}
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
            <input
              name="password"
              type="password"
              required
              className={inputClass}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="w-full flex justify-center py-2.5 px-4 text-sm font-semibold rounded-xl text-white bg-primary-500 hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
          >
            {isLogin ? 'Sign in' : 'Sign up'}
          </button>

          {registrationOpen && (
            <div className="text-center">
              <button
                type="button"
                className="font-medium text-primary-600 dark:text-primary-400 hover:text-primary-500 text-sm"
                onClick={() => setIsLogin(!isLogin)}
              >
                {isLogin ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
