const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { ValidationError, BaseError } = require('../utils/errors');

const configuredSize = Number(process.env.DISPUTE_EVIDENCE_MAX_FILE_SIZE_BYTES);
const MAX_EVIDENCE_FILE_SIZE = Number.isFinite(configuredSize) && configuredSize > 0
  ? Math.floor(configuredSize)
  : 5 * 1024 * 1024;
const STORAGE_DIR = path.resolve(process.env.DISPUTE_EVIDENCE_STORAGE_DIR
  || path.join(__dirname, '../../uploads/dispute-evidence'));
const EXTENSION_MIME = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

const storage = multer.diskStorage({
  destination: (req, file, callback) => fs.mkdir(STORAGE_DIR, { recursive: true }, error => callback(error, STORAGE_DIR)),
  filename: (req, file, callback) => {
    const extension = path.extname(String(file.originalname || '').replace(/\\/g, '/')).toLowerCase();
    callback(null, `${uuidv4()}${EXTENSION_MIME[extension] ? extension : '.upload'}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_EVIDENCE_FILE_SIZE, files: 1, fields: 2, fieldSize: 4096 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(String(file.originalname || '').replace(/\\/g, '/')).toLowerCase();
    const expectedMime = EXTENSION_MIME[extension];
    if (!expectedMime) return callback(new ValidationError('Only PDF, JPG, JPEG, and PNG evidence files are supported'));
    if (file.mimetype !== expectedMime) return callback(new ValidationError('File extension and MIME type do not match'));
    callback(null, true);
  },
});

function uploadDisputeEvidence(req, res, next) {
  upload.single('file')(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return next(new BaseError(`Evidence file exceeds the ${Math.floor(MAX_EVIDENCE_FILE_SIZE / (1024 * 1024))} MB size limit`, 413, 'FILE_TOO_LARGE'));
    }
    if (error instanceof multer.MulterError) return next(new ValidationError(`Invalid evidence upload: ${error.message}`));
    next(error);
  });
}

module.exports = { uploadDisputeEvidence, STORAGE_DIR, MAX_EVIDENCE_FILE_SIZE, EXTENSION_MIME };
