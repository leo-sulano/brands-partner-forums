import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { MessageCircle, X, Send } from 'lucide-react';
import { streamAssistant, type ChatMessage } from '../lib/assistant';
import { useAssistant } from '../contexts/AssistantContext';

export default function AssistantWidget() {
  const { open, openWith, close, seed, clearSeed } = useAssistant();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const location = useLocation();
  const params = useParams();
  const listRef = useRef<HTMLDivElement>(null);

  // Pre-seed the input when a page requests it (e.g. MentionDetail buttons).
  useEffect(() => {
    if (seed) {
      setInput(seed);
      clearSeed();
    }
  }, [seed, clearSeed]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, streaming]);

  function pageContext(): string | undefined {
    const path = location.pathname;
    if (path.startsWith('/mentions/') && params.id) return `Viewing entry id ${params.id}.`;
    if (path.startsWith('/brands/') && params.tab) return `Viewing brand tab "${params.tab}".`;
    if (path === '/') return 'Viewing the overview page.';
    return undefined;
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setStreaming(true);
    setMessages((m) => [...m, { role: 'assistant', content: '' }]);
    await streamAssistant(next, pageContext(), {
      onToken: (tok) =>
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: 'assistant',
            content: copy[copy.length - 1].content + tok,
          };
          return copy;
        }),
      onError: (msg) =>
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: `⚠️ ${msg}` };
          return copy;
        }),
      onDone: () => setStreaming(false),
    });
    setStreaming(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => openWith()}
        aria-label="Open assistant"
        className="fixed bottom-5 right-5 z-50 flex size-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700"
      >
        <MessageCircle className="size-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[32rem] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <span className="text-sm font-semibold text-slate-800">Assistant</span>
        <button
          onClick={close}
          aria-label="Close assistant"
          className="text-slate-400 hover:text-slate-700"
        >
          <X className="size-5" />
        </button>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">
            Ask about forum mentions, scores, or get help drafting a reply.
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <span
                className={[
                  'inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
                  m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-800',
                ].join(' ')}
              >
                {m.content || (streaming && i === messages.length - 1 ? '…' : '')}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-slate-200 p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Type a message…"
          className="flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          aria-label="Send"
          className="flex size-9 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}
