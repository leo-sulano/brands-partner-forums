import { supabase, AI_ASSISTANT_URL, SUPABASE_ANON_KEY } from './supabase';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

// POSTs the conversation to the ai-assistant Edge Function and parses the SSE
// stream. `context` is an optional hidden note about the current page/entity.
export async function streamAssistant(
  messages: ChatMessage[],
  context: string | undefined,
  cb: StreamCallbacks,
): Promise<void> {
  if (!AI_ASSISTANT_URL) {
    cb.onError('Assistant not configured');
    return;
  }

  // Prefer the logged-in user's access token; fall back to the anon key.
  let token = SUPABASE_ANON_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) token = data.session.access_token;
  } catch {
    /* fall back to anon key */
  }

  let res: Response;
  try {
    res = await fetch(AI_ASSISTANT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ messages, context }),
    });
  } catch (e) {
    cb.onError((e as Error).message || 'Network error');
    return;
  }

  if (!res.ok || !res.body) {
    cb.onError('Assistant unavailable — try again');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith('data:')) continue;
      let payload: { token?: string; done?: boolean; error?: string };
      try {
        payload = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      if (payload.error) {
        cb.onError(payload.error);
        return;
      }
      if (payload.token) cb.onToken(payload.token);
      if (payload.done) {
        cb.onDone();
        return;
      }
    }
  }
  cb.onDone();
}
