const { invalidDraft } = require('../domain/milestoneDraft');

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

async function generateGeminiDraft({ prompt, responseSchema, project, signal, timeoutMs }) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  if (!apiKey || !/^gemini-[a-z0-9.-]+$/.test(model)) {
    throw Object.assign(new Error('Gemini is not configured'), { code: 'AI_NOT_CONFIGURED' });
  }

  const { GoogleGenAI } = require('@google/genai');
  const client = new GoogleGenAI({ apiKey, vertexai: false });
  const response = await client.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: JSON.stringify(project) }] }],
    config: {
      systemInstruction: prompt,
      responseMimeType: 'application/json',
      responseJsonSchema: responseSchema,
      maxOutputTokens: 4096,
      candidateCount: 1,
      abortSignal: signal,
      httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } },
      automaticFunctionCalling: { disable: true },
      automaticContinuation: false,
    },
  });
  if (response.candidates?.[0]?.finishReason !== 'STOP') throw invalidDraft();
  return response.text;
}

module.exports = generateGeminiDraft;
