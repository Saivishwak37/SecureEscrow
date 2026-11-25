const fs = require('node:fs');
const path = require('node:path');
const { ValidationError } = require('../utils/errors');

const SIGNATURES = [
  { extension: '.pdf', mimeType: 'application/pdf', type: 'PDF', matches: bytes => bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) },
  { extension: '.jpg', mimeType: 'image/jpeg', type: 'JPEG', matches: bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { extension: '.jpeg', mimeType: 'image/jpeg', type: 'JPEG', matches: bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { extension: '.png', mimeType: 'image/png', type: 'PNG', matches: bytes => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
];

function cleanDisplayName(originalName, extension) {
  const normalized = String(originalName || '').replace(/\\/g, '/');
  const baseName = path.posix.basename(normalized)
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .slice(0, 180);
  return baseName || `evidence${extension}`;
}

function identifyEvidence(file, bytes) {
  const extension = path.extname(String(file.originalname || '').replace(/\\/g, '/')).toLowerCase();
  const byExtension = SIGNATURES.find(candidate => candidate.extension === extension);
  if (!byExtension) throw new ValidationError('Only PDF, JPG, JPEG, and PNG evidence files are supported');
  if (file.mimetype !== byExtension.mimeType) throw new ValidationError('File extension and MIME type do not match');
  const detected = SIGNATURES.find(candidate => candidate.matches(bytes));
  if (!detected) throw new ValidationError('File signature is not a supported PDF, JPEG, or PNG');
  if (detected.mimeType !== byExtension.mimeType) throw new ValidationError('File extension does not match the actual file contents');
  return detected;
}

async function removeStoredFile(filePath) {
  if (!filePath) return;
  try { await fs.promises.unlink(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

module.exports = { cleanDisplayName, identifyEvidence, removeStoredFile };
