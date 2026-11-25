const { readInput, readDraft, presentDraft, prompt, responseSchema, invalidDraft } = require('../domain/milestoneDraft');
const { BaseError } = require('../utils/errors');
const generateGeminiDraft = require('./geminiMilestones');

function providerError(error, signal) {
  const status = Number(error?.status ?? error?.statusCode);
  if (signal.aborted || status === 408 || status === 504
    || ['AbortError', 'TimeoutError', 'RequestTimeoutError'].includes(error?.name)) {
    return new BaseError('AI generation timed out. Try again or enter milestones manually.', 504, 'AI_TIMEOUT');
  }
  if (error?.errorType === 'AI_INVALID_OUTPUT') return invalidDraft();
  if (status === 429) return new BaseError('AI generation is temporarily at capacity. Try again later.', 503, 'AI_QUOTA_EXCEEDED');
  if (error?.code === 'AI_NOT_CONFIGURED' || [401, 403, 404].includes(status)) {
    return new BaseError('AI generation is unavailable. Enter milestones manually or check server configuration.', 503, 'AI_UNAVAILABLE');
  }
  return new BaseError('AI generation failed. Try again or enter milestones manually.', 502, 'AI_PROVIDER_ERROR');
}

function createMilestoneGenerator({ provider = generateGeminiDraft, timeoutMs = 20_000 } = {}) {
  return async function generateMilestones(body) {
    const input = readInput(body);
    const { title, description, durationDays } = input;
    const controller = new AbortController();
    let timeout;
    let raw;
    try {
      const deadline = new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('AI request exceeded deadline'));
        }, timeoutMs);
      });
      // Pass project text only. The provider never receives the budget, user identity or tools.
      const response = provider({ prompt, responseSchema, project: { title, description, durationDays }, signal: controller.signal, timeoutMs });
      raw = await Promise.race([response, deadline]);
    } catch (error) {
      throw providerError(error, controller.signal);
    } finally {
      clearTimeout(timeout);
    }
    return presentDraft(input, readDraft(raw, durationDays));
  };
}

module.exports = createMilestoneGenerator;
