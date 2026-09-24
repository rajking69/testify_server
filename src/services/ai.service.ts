import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';

export interface GekkoChatContext {
  page?: 'dashboard' | 'question-bank' | 'exam' | 'other' | string;
  examId?: string;
  questionId?: string;
  examStatus?: 'ACTIVE' | 'UPCOMING' | 'COMPLETED' | 'EXPIRED' | string;
  isLiveExam?: boolean;
}

export interface ChatMessageHistoryItem {
  sender: 'user' | 'gekko';
  text: string;
}

export type AIProvider = 'gemini' | 'grok';

export interface AIResponseChunk {
  text: string;
  isComplete: boolean;
  provider: AIProvider;
}

export interface AIError {
  code: string;
  message: string;
  isTemporary: boolean;
  provider: AIProvider;
  statusCode?: number;
}

interface ProviderConfig {
  name: AIProvider;
  timeout: number; // per-chunk idle timeout (super long = no timeout)
  ttftTimeout: number; // time to first token timeout (super fast fallback)
  maxRetries: number;
  retryDelay: number;
}

interface ProviderHealth {
  failures: number;
  lastFailure: number;
  cooldownUntil: number;
  isAvailable: boolean;
}

const PROVIDER_CONFIG: Record<AIProvider, ProviderConfig> = {
  gemini: {
    name: 'gemini',
    timeout: 30000,
    ttftTimeout: 7000,
    maxRetries: 2,
    retryDelay: 700,
  },
  grok: {
    name: 'grok',
    timeout: 30000,
    ttftTimeout: 7000,
    maxRetries: 0,
    retryDelay: 0,
  },
};

const PROVIDER_HEALTH: Record<AIProvider, ProviderHealth> = {
  gemini: { failures: 0, lastFailure: 0, cooldownUntil: 0, isAvailable: true },
  grok: { failures: 0, lastFailure: 0, cooldownUntil: 0, isAvailable: true },
};

const COOLDOWN_MS = 20000;
const MAX_FAILURES_BEFORE_COOLDOWN = 2;

function buildSystemInstruction(userRole: string, userName: string): string {
  return `
You are Gekko, the AI Study Assistant for Testify (Testify is a modern online examination, assessment, and study platform for students and teachers).

YOUR IDENTITY & ROLE:
- Display Name: Gekko AI (Testify AI Study Assistant).
- Personality: Friendly, encouraging, clear, educational, smart, concise.
- Target Audience: You assist authenticated Testify users (Current User Role: ${userRole.toUpperCase()}, Name: ${userName || 'Learner'}).

ALLOWED CONVERSATIONAL TOPICS:
1. Testify platform usage & feature guidance (dashboards, exam taking, question bank, results, transcripts, subscriptions).
2. Educational concepts across any subject (Math, Science, Computer Science, Literature, History, Engineering, Business, etc.).
3. Exam preparation strategies, study tips, and revision guidance.
4. Explaining questions, options, and reasoning when in study/practice mode.
5. For Teachers (${userRole === 'teacher' ? 'ACTIVE' : 'INACTIVE'}): Guidance on creating quality MCQs, configuring exams, setting pass marks, and managing Question Bank items.

STRICT RESTRICTIONS & OUT-OF-SCOPE REFUSAL:
- You must NOT engage in personal non-educational chat, dating advice, relationships, casual gossip, politics, or general non-Testify non-educational chatter.
- IF THE USER ASKS AN UNRELATED TOPIC, POLITELY REFUSE WITH THIS EXACT MESSAGE:
  "I'm Gekko, Testify's AI Study Assistant. I can help with Testify, exams, and educational topics."
- ANTI-CHEATING RULE: NEVER solve an active exam for a student or reveal direct answer keys for an ongoing live exam. (Active exams block AI access).

FORMATTING & STYLE:
- Use clean Markdown with bold titles, bullet points, and numbered lists where appropriate.
- Keep responses focused, helpful, and concise. Avoid unnecessary fluff.
`;
}

function formatHistory(history?: ChatMessageHistoryItem[]): string {
  if (!Array.isArray(history) || history.length === 0) return '';
  return history
    .slice(-6)
    .map((item) => `${item.sender === 'user' ? 'User' : 'Gekko'}: ${item.text.slice(0, 300)}`)
    .join('\n');
}

function buildPrompt(userMessage: string, context?: GekkoChatContext, history?: ChatMessageHistoryItem[]): string {
  const formattedHistory = formatHistory(history);
  return `
[Context: Page=${context?.page || 'general'}, Role=${context?.examStatus || 'general'}]
${formattedHistory ? `[Recent Conversation History]:\n${formattedHistory}\n` : ''}
User Message: "${userMessage}"
`;
}

function classifyError(err: any, provider: AIProvider): AIError {
  const message = err?.message || String(err);
  const statusCode = err?.status || err?.response?.status || err?.code;

  const isTimeout = message.includes('timeout') || message.includes('ETIMEDOUT') || message.includes('ESOCKETTIMEDOUT');
  const is429 = statusCode === 429 || message.includes('429') || message.includes('rate limit');
  const is5xx = statusCode >= 500 && statusCode < 600;
  const isNetwork = message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') || message.includes('network');

  const isTemporary = isTimeout || is429 || is5xx || isNetwork;

  let code = 'AI_PROVIDER_ERROR';
  if (isTimeout) code = 'AI_TIMEOUT';
  else if (is429) code = 'AI_RATE_LIMIT';
  else if (is5xx) code = 'AI_SERVER_ERROR';
  else if (isNetwork) code = 'AI_NETWORK_ERROR';

  return {
    code,
    message: `Provider ${provider} error: ${message}`,
    isTemporary,
    provider,
    statusCode,
  };
}

function recordFailure(provider: AIProvider) {
  const health = PROVIDER_HEALTH[provider];
  health.failures++;
  health.lastFailure = Date.now();
  if (health.failures >= MAX_FAILURES_BEFORE_COOLDOWN) {
    health.cooldownUntil = Date.now() + COOLDOWN_MS;
    health.isAvailable = false;
    console.warn(`[GEKKO] Provider ${provider} entered cooldown until ${new Date(health.cooldownUntil).toISOString()}`);
  }
}

function recordSuccess(provider: AIProvider) {
  const health = PROVIDER_HEALTH[provider];
  health.failures = 0;
  health.isAvailable = true;
  health.cooldownUntil = 0;
}

function isProviderAvailable(provider: AIProvider): boolean {
  const health = PROVIDER_HEALTH[provider];
  if (!health.isAvailable && Date.now() > health.cooldownUntil) {
    health.isAvailable = true;
    health.failures = 0;
    console.log(`[GEKKO] Provider ${provider} cooldown expired, available again`);
  }
  return health.isAvailable;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function* withStreamTimeout(
  stream: AsyncGenerator<string>,
  ms: number,
  provider: AIProvider,
  ttftMs?: number
): AsyncGenerator<string> {
  const iterator = stream[Symbol.asyncIterator]();
  let isFirst = true;
  while (true) {
    const timeoutMs = isFirst && ttftMs ? ttftMs : ms;
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<{ done: true; value: undefined }>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Provider ${provider} timeout after ${timeoutMs}ms${isFirst ? ' (ttft)' : ''}`)), timeoutMs);
    });
    const nextPromise = iterator.next();
    try {
      const result = await Promise.race([nextPromise, timeoutPromise]) as IteratorResult<string>;
      if (timer) clearTimeout(timer);
      if (result.done) return;
      isFirst = false;
      yield result.value;
    } catch (err) {
      if (timer) clearTimeout(timer);
      try { await (iterator as any).return?.(); } catch {}
      throw err;
    }
  }
}

export class AIService {
  private geminiClient: GoogleGenAI | null = null;
  private grokApiKey: string | undefined;
  private grokBaseUrl = 'https://api.x.ai/v1';

  constructor() {
    const geminiKey = env.gemini_api_key || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        this.geminiClient = new GoogleGenAI({ apiKey: geminiKey });
      } catch (err) {
        console.error('[Gekko AI] Failed to initialize GoogleGenAI client:', err);
      }
    } else {
      console.warn('[Gekko AI] Warning: GEMINI_API_KEY is not configured.');
    }

    this.grokApiKey = env.xai_api_key || process.env.XAI_API_KEY;
    if (!this.grokApiKey) {
      console.warn('[Gekko AI] Warning: XAI_API_KEY is not configured. Grok fallback unavailable.');
    }
  }

  private logTiming(event: string, data: Record<string, any>) {
    const timestamp = new Date().toISOString();
    console.log(`[GEKKO] ${timestamp} ${event}`, JSON.stringify(data));
  }

  async generateGekkoResponse(
    userMessage: string,
    userRole: 'student' | 'teacher' | 'admin',
    userName?: string,
    context?: GekkoChatContext,
    history?: ChatMessageHistoryItem[]
  ): Promise<string> {
    const chunks: string[] = [];
    for await (const chunk of this.generateGekkoResponseStream(userMessage, userRole, userName, context, history)) {
      if (chunk.text) chunks.push(chunk.text);
    }
    return chunks.join('');
  }

  async *generateGekkoResponseStream(
    userMessage: string,
    userRole: 'student' | 'teacher' | 'admin',
    userName?: string,
    context?: GekkoChatContext,
    history?: ChatMessageHistoryItem[]
  ): AsyncGenerator<AIResponseChunk> {
    const requestStart = Date.now();
    let firstChunkLogged = false;
    let providerUsed: AIProvider = 'gemini';

    if (context?.examStatus === 'ACTIVE' || context?.isLiveExam === true || context?.page === 'exam-live') {
      yield { text: "Gekko AI is disabled during live active examinations to preserve academic integrity. Best of luck with your test!", isComplete: true, provider: 'gemini' };
      return;
    }

    const systemInstruction = buildSystemInstruction(userRole, userName || 'Learner');
    const prompt = buildPrompt(userMessage, context, history);

    const providers: AIProvider[] = ['gemini', 'grok'];

    for (const provider of providers) {
      if (!isProviderAvailable(provider)) {
        this.logTiming('provider_skipped_cooldown', { provider, userRole });
        continue;
      }

      const config = PROVIDER_CONFIG[provider];
      let lastError: AIError | null = null;

      for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
          this.logTiming('provider_attempt', { provider, attempt: attempt + 1, maxRetries: config.maxRetries + 1, userRole });

          let stream: AsyncGenerator<string> | null = null;

          if (provider === 'gemini') {
            if (!this.geminiClient) throw new Error('Gemini client not initialized');
            stream = this.streamGemini(prompt, systemInstruction);
          } else {
            if (!this.grokApiKey) throw new Error('Grok API key not configured');
            stream = this.streamGrok(prompt, systemInstruction);
          }

          providerUsed = provider;
          let hasStreamedContent = false;
          const timedStream = withStreamTimeout(stream!, config.timeout, provider, config.ttftTimeout);

          for await (const chunk of timedStream) {
            if (!firstChunkLogged) {
              const ttft = Date.now() - requestStart;
              this.logTiming('first_chunk', { provider, ttft, userRole });
              firstChunkLogged = true;
            }
            hasStreamedContent = true;
            yield { text: chunk, isComplete: false, provider };
          }

          if (hasStreamedContent) {
            const totalDuration = Date.now() - requestStart;
            this.logTiming('completed', { provider, totalDuration, userRole });
            recordSuccess(provider);
            yield { text: '', isComplete: true, provider };
            return;
          } else {
            throw new Error('Empty response from provider');
          }
        } catch (err: any) {
          lastError = classifyError(err, provider);
          this.logTiming('provider_error', { provider, attempt: attempt + 1, error: lastError, userRole });

          if (!lastError.isTemporary) {
            recordFailure(provider);
            break;
          }

          if (attempt < config.maxRetries) {
            await sleep(config.retryDelay * (attempt + 1));
            continue;
          }

          recordFailure(provider);
          break;
        }
      }

      if (lastError?.isTemporary && provider === 'gemini') {
        this.logTiming('fallback_triggered', { from: 'gemini', to: 'grok', userRole });
        continue;
      }
    }

    this.logTiming('both_providers_failed', { userRole, providerUsed });
    yield {
      text: "I'm temporarily unavailable. Please try again in a moment.",
      isComplete: true,
      provider: providerUsed,
    };
  }

  private async *streamGemini(prompt: string, systemInstruction: string): AsyncGenerator<string> {
    const candidateModels = [
      env.gemini_model || 'gemini-3.6-flash',
      'gemini-3.6-flash',
      'gemini-3.8-flash',
      'gemini-flash-latest',
    ];

    for (const modelName of candidateModels) {
      try {
        const result = await this.geminiClient!.models.generateContentStream({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction,
            temperature: 0.7,
            maxOutputTokens: 700,
            // @ts-ignore - disable thinking for super fast free tier
            thinkingConfig: { thinkingBudget: 0 },
          } as any,
        });

        for await (const chunk of result) {
          if (chunk.text) yield chunk.text;
        }
        return;
      } catch (err: any) {
        console.warn(`[Gekko AI] Model ${modelName} stream failed:`, err?.message || err);
      }
    }
    throw new Error('All Gemini models failed');
  }

  private async *streamGrok(prompt: string, systemInstruction: string): AsyncGenerator<string> {
    if (!this.grokApiKey) throw new Error('Grok API key not configured');

    const response = await fetch(`${this.grokBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.grokApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.grok_model || 'grok-3',
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt },
        ],
        stream: true,
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Grok API error: ${response.status} ${errorText}`);
    }

    if (!response.body) throw new Error('No response body from Grok');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  }
}

export const aiService = new AIService();