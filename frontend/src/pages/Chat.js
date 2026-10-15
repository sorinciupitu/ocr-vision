import React, { useState } from 'react';
import { PaperAirplaneIcon, CpuChipIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../services/api';

const cardClass = 'bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm';

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const send = async (event) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending) return;
    const next = [...messages, { role: 'user', content: message }];
    setMessages(next);
    setInput('');
    setSending(true);
    try {
      const response = await api.post('/chat', { message, history: messages });
      setMessages([...next, { role: 'assistant', content: response.data.answer, sources: response.data.sources }]);
    } catch (err) {
      const detail = err.response?.data?.detail || 'Nu am putut contacta modelul configurat.';
      toast.error(detail, { duration: 7000 });
      setMessages(messages);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className={`${cardClass} p-6 md:p-8`}>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-300"><CpuChipIcon className="w-6 h-6" /></div>
          <div><h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">AI Chat</h1><p className="text-sm text-gray-500 dark:text-gray-400">Întreabă despre documentele OCR finalizate.</p></div>
        </div>
        <div className="space-y-4 min-h-[280px] max-h-[55vh] overflow-y-auto py-4">
          {messages.length === 0 && <p className="text-center text-gray-400 dark:text-gray-500 py-20">Exemplu: „Când expiră ITP-ul mașinii?”</p>}
          {messages.map((item, index) => (
            <div key={`${item.role}-${index}`} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 whitespace-pre-wrap text-sm ${item.role === 'user' ? 'bg-primary-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100'}`}>
                {item.content}
                {item.sources?.length > 0 && <p className="mt-3 pt-2 border-t border-black/10 dark:border-white/10 text-xs opacity-70">Surse: {item.sources.join(', ')}</p>}
              </div>
            </div>
          ))}
          {sending && <p className="text-sm text-gray-400 animate-pulse">Modelul analizează documentele…</p>}
        </div>
        <form onSubmit={send} className="flex gap-2 border-t border-gray-100 dark:border-gray-800 pt-4">
          <input value={input} onChange={(e) => setInput(e.target.value)} className="flex-1 px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500" placeholder="Scrie întrebarea…" disabled={sending} />
          <button type="submit" disabled={sending || !input.trim()} className="px-4 rounded-xl bg-primary-500 text-white disabled:opacity-50"><PaperAirplaneIcon className="w-5 h-5" /></button>
        </form>
      </div>
    </div>
  );
}
