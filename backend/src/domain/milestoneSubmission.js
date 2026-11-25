const { ValidationError } = require('../utils/errors');

function normalizeAttachments(submission) {
  const attachments = Array.isArray(submission.attachments) ? submission.attachments : [];
  if (!attachments.length) throw new ValidationError('Attach at least one file with your submission');
  if (attachments.length > 5) throw new ValidationError('You can attach up to 5 files per submission');
  const normalized = attachments.map(file => {
    if (!file || typeof file.name !== 'string' || typeof file.data !== 'string' || typeof file.type !== 'string') throw new ValidationError('Each attachment must include a name, type, and file data');
    if (!file.data.startsWith('data:')) throw new ValidationError('Attachment data is invalid');
    if (file.data.length > 7_000_000) throw new ValidationError('Each file must be 5 MB or smaller');
    return { name: file.name.slice(0, 255), type: file.type || 'application/octet-stream', data: file.data };
  });
  if (normalized.reduce((total, file) => total + file.data.length, 0) > 9_000_000) throw new ValidationError('The combined submission files must be smaller than 7 MB');
  return normalized;
}

module.exports = normalizeAttachments;
