const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { STORAGE_DIR, MAX_EVIDENCE_FILE_SIZE } = require('../middleware/disputeEvidenceUpload');
const { cleanDisplayName, identifyEvidence, removeStoredFile } = require('../domain/evidenceFiles');
const { timestamps } = require('../repositories/postgresCore');
const { active } = require('./postgresDisputes');
const { NotFoundError, ValidationError } = require('../utils/errors');

function evidenceResponse({ storageKey, ...row }) {
  return timestamps({
    ...row, downloadUrl: `/api/disputes/${encodeURIComponent(row.disputeId)}/evidence/${encodeURIComponent(row.id)}/file`,
  });
}

function postgresEvidence(db, disputes) {
  async function upload(id, actor, file, description) {
    if (!file) throw new ValidationError('Evidence file is required');
    let attemptedWrite = false;
    const storageKey = path.basename(file.filename);
    try {
      const bytes = await fs.readFile(file.path);
      if (!bytes.length || bytes.length > MAX_EVIDENCE_FILE_SIZE) throw new ValidationError('Evidence is empty or exceeds the configured size limit');
      const format = identifyEvidence(file, bytes);
      const explanation = typeof description === 'string' ? description.trim() : '';
      if (explanation.length > 2000) throw new ValidationError('Evidence description must be 2000 characters or fewer');
      return await disputes.withDispute(id, actor, async (tx, context) => {
        active(context);
        attemptedWrite = true;
        return evidenceResponse(await tx.disputeEvidence.create({ data: {
          disputeId: id, uploadedBy: actor.userId, type: format.type, description: explanation,
          fileName: cleanDisplayName(file.originalname, format.extension), storageKey, mimeType: format.mimeType,
          fileSize: bytes.length, fileHash: createHash('sha256').update(bytes).digest('hex'),
        } }));
      }, false);
    } catch (error) {
      // If a connection failed at commit, preserve a file whose metadata may have committed.
      try {
        const saved = attemptedWrite && await db.disputeEvidence.findUnique({ where: { storageKey } });
        if (!saved) await removeStoredFile(file.path);
      } catch { /* Leave the private file in place when cleanup cannot be verified. */ }
      throw error;
    }
  }

  async function list(id, actor) {
    await disputes.lookup(id, actor);
    return (await db.disputeEvidence.findMany({ where: { disputeId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(evidenceResponse);
  }

  async function download(id, evidenceId, actor, res) {
    await disputes.lookup(id, actor);
    const row = await db.disputeEvidence.findFirst({ where: { id: evidenceId, disputeId: id } });
    if (!row || !/^[a-f0-9-]+\.(pdf|jpe?g|png)$/.test(row.storageKey)) throw new NotFoundError('Dispute evidence', evidenceId);
    const root = await fs.realpath(STORAGE_DIR).catch(error => {
      if (error.code === 'ENOENT') throw new NotFoundError('Evidence file', evidenceId);
      throw error;
    });
    const filePath = path.join(root, row.storageKey);
    try {
      const stat = await fs.lstat(filePath);
      if (!stat.isFile() || stat.size !== row.fileSize || await fs.realpath(filePath) !== filePath) {
        throw new NotFoundError('Evidence file', evidenceId);
      }
    } catch (error) {
      if (error.code === 'ENOENT') throw new NotFoundError('Evidence file', evidenceId);
      throw error;
    }
    const ascii = row.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const encoded = encodeURIComponent(row.fileName.toWellFormed()).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    res.set({
      'Content-Type': row.mimeType, 'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "sandbox; default-src 'none'",
    });
    await new Promise((resolve, reject) => res.sendFile(filePath, { cacheControl: false }, error => error ? reject(error) : resolve()));
  }

  return { upload, list, download };
}

module.exports = postgresEvidence;
