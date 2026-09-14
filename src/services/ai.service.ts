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

export class AIService {
  private aiClient: GoogleGenAI | null = null;

  constructor() {
    const apiKey = env.gemini_api_key || process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        this.aiClient = new GoogleGenAI({ apiKey });
      } catch (err) {
        console.error('[Gekko AI] Failed to initialize GoogleGenAI client:', err);
      }
    } else {
      console.warn('[Gekko AI] Warning: GEMINI_API_KEY is not configured.');
    }
  }

  /**
   * Generates a conversational response from Gekko AI
   */
  async generateGekkoResponse(
    userMessage: string,
    userRole: 'student' | 'teacher' | 'admin',
    userName?: string,
    context?: GekkoChatContext,
    history?: ChatMessageHistoryItem[]
  ): Promise<string> {
    // 1. Anti-Cheating & Live Exam Guard
    if (context?.examStatus === 'ACTIVE' || context?.isLiveExam === true || context?.page === 'exam-live') {
      return "Gekko AI is disabled during live active examinations to preserve academic integrity. Best of luck with your test!";
    }

    if (!this.aiClient) {
      return "Gekko AI service is currently unavailable. Please verify the Gemini API key configuration on the server.";
    }

    // 2. Build Gekko System Instruction
    const systemInstruction = `
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

    // 3. Prepare Prompt History
    const formattedHistory = Array.isArray(history)
      ? history.slice(-10).map((item) => `${item.sender === 'user' ? 'User' : 'Gekko'}: ${item.text}`).join('\n')
      : '';

    const currentPrompt = `
[Context: Page=${context?.page || 'general'}, Role=${userRole}]
${formattedHistory ? `[Recent Conversation History]:\n${formattedHistory}\n` : ''}
User Message: "${userMessage}"
`;

    // 4. Call Gemini Model via GoogleGenAI SDK with Fallbacks
    const candidateModels = [
      env.gemini_model || 'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-2.0-flash',
      'gemini-flash',
    ];

    for (const modelName of candidateModels) {
      try {
        const response = await this.aiClient.models.generateContent({
          model: modelName,
          contents: currentPrompt,
          config: {
            systemInstruction,
            temperature: 0.7,
            maxOutputTokens: 1000,
          },
        });

        if (response && response.text) {
          return response.text.trim();
        }
      } catch (err: any) {
        console.warn(`[Gekko AI] Model ${modelName} call failed:`, err?.message || err);
      }
    }

    return "Sorry, Gekko is temporarily unable to process your request. Please try again in a moment.";
  }
}

export const aiService = new AIService();
