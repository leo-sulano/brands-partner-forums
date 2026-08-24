import { useEffect, useRef, useState } from 'react';
import { Send, Mic } from 'lucide-react';
import { streamAssistant, type ChatMessage } from '../lib/assistant';
import Toast from '../components/Toast';

const speechSupported =
  typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

export default function AskAI() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, streaming]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || streaming) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: msg }];
    setMessages(next);
    setInput('');
    setStreaming(true);
    setMessages((m) => [...m, { role: 'assistant', content: '' }]);
    await streamAssistant(next, 'Using the Ask AI page.', {
      onToken: (tok) =>
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = {
            role: 'assistant',
            content: copy[copy.length - 1].content + tok,
          };
          return copy;
        }),
      onError: (msg) => {
        setStreaming(false);
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: 'assistant', content: `⚠️ ${msg}` };
          return copy;
        });
      },
      onDone: () => setStreaming(false),
    });
  }

  function toggleVoice() {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }
    // webkitSpeechRecognition is the vendor-prefixed form; not typed in lib.dom.d.ts
    const SR = window.SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    const recognition: SpeechRecognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.addEventListener('result', (e) => {
      const transcript = e.results[0][0].transcript.trim();
      setRecording(false);
      if (transcript) send(transcript);
    });

    recognition.addEventListener('error', (e) => {
      if (e.error === 'no-speech') return;
      setToastMsg(
        e.error === 'not-allowed'
          ? 'Microphone access denied'
          : 'Voice recognition unavailable',
      );
    });

    recognition.addEventListener('end', () => {
      setRecording(false);
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    });

    recognition.addEventListener('start', () => setRecording(true));
    recognitionRef.current = recognition;
    recognition.start();
  }

  return (
    <>
      {toastMsg && (
        <Toast message={toastMsg} kind="error" onClose={() => setToastMsg(null)} />
      )}
      <div className="flex h-full flex-col">
        <div ref={listRef} className="flex-1 overflow-y-auto pb-4">
          <div className="mx-auto w-full max-w-2xl space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-400">
                Ask anything about forum mentions, scores, or brands.
              </p>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                  <span
                    className={[
                      'inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
                      m.role === 'user'
                        ? 'bg-brand-600 text-white'
                        : 'bg-slate-100 text-slate-800',
                    ].join(' ')}
                  >
                    {m.content || (streaming && i === messages.length - 1 ? '…' : '')}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border-t border-slate-200 pt-4">
          <div className="mx-auto flex w-full max-w-2xl items-end gap-2">
            {speechSupported && (
              <button
                onClick={toggleVoice}
                disabled={streaming}
                aria-label={recording ? 'Stop recording' : 'Start voice input'}
                className={[
                  'relative flex size-9 shrink-0 items-center justify-center rounded-md disabled:opacity-40',
                  recording
                    ? 'bg-red-50 text-red-600'
                    : 'text-slate-400 hover:bg-blue-50 hover:text-slate-700',
                ].join(' ')}
              >
                {recording && (
                  <span className="absolute inline-flex size-full animate-ping rounded-md bg-red-300 opacity-60" />
                )}
                <Mic className="relative size-4" />
              </button>
            )}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={recording}
              rows={1}
              placeholder={recording ? 'Listening…' : 'Type a message…'}
              className={[
                'flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none',
                recording ? 'opacity-50' : '',
              ].join(' ')}
            />
            <button
              onClick={() => send()}
              disabled={streaming || !input.trim() || recording}
              aria-label="Send"
              className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-40"
            >
              <Send className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
