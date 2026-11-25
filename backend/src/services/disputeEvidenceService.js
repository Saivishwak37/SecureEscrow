const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getStore } = require('../data/store');
const escrowRepository = require('../repositories/escrowRepository');
const disputeRepository = require('../repositories/disputeRepository');
const evidenceRepository = require('../repositories/disputeEvidenceRepository');
const { STORAGE_DIR, MAX_EVIDENCE_FILE_SIZE } = require('../middleware/disputeEvidenceUpload');
const { ValidationError, UnauthorizedError, NotFoundError } = require('../utils/errors');

const { cleanDisplayName, identifyEvidence, removeStoredFile } = require('../domain/evidenceFiles');

function getActiveEscrowParticipantIds(escrow) {
  return escrow.participants?.length
    ? escrow.participants.filter(item => ['PAYER', 'PAYEE', 'CLIENT', 'PROVIDER'].includes(item.role)).map(item => item.userId)
    : [escrow.payerId || escrow.clientId, escrow.payeeId || escrow.freelancerId];
}

function getAuthorizedDispute(disputeId, actorId, allowAdmin = true) {
  if (typeof actorId !== 'string' || !actorId) throw new UnauthorizedError('A participant identity is required');
  const dispute = disputeRepository.getDisputeById(disputeId);
  const escrow = escrowRepository.getEscrowById(dispute.escrowId);
  const user = getStore().findById('users', actorId);
  const role = user?.role || user?.type;
  if (user && user.isActive !== false && getActiveEscrowParticipantIds(escrow).includes(actorId)
    && ((role === 'CLIENT' && actorId === (escrow.clientId || escrow.payerId))
      || (role === 'PROVIDER' && actorId === (escrow.freelancerId || escrow.payeeId)))) return { dispute, escrow };
  if (allowAdmin && user?.isActive !== false && role === 'ADMIN') return { dispute, escrow };
  throw new UnauthorizedError('Only an escrow participant or authorized admin may access dispute evidence');
}

function publicEvidence(evidence) {
  const { storageKey, ...metadata } = evidence;
  return metadata;
}

async function uploadEvidence(disputeId, actorId, file, description = '') {
  if (!file) throw new ValidationError('Evidence file is required');
  try {
    const { dispute, escrow } = getAuthorizedDispute(disputeId, actorId, false);
    if (dispute.status === 'RESOLVED') throw new ValidationError('Evidence can only be uploaded while a dispute is active');
    if (escrow.status !== 'DISPUTED' || !escrow.disputed) throw new ValidationError('Evidence cannot be uploaded for an inconsistent dispute state');

    const stat = await fs.promises.stat(file.path);
    if (!stat.isFile() || stat.size === 0) throw new ValidationError('Evidence file cannot be empty');
    if (stat.size > MAX_EVIDENCE_FILE_SIZE) throw new ValidationError('Evidence file exceeds the configured size limit');
    const bytes = await fs.promises.readFile(file.path);
    const format = identifyEvidence(file, bytes);
    const explanation = typeof description === 'string' ? description.trim() : '';
    if (explanation.length > 2000) throw new ValidationError('Evidence description must be 2000 characters or fewer');

    const metadata = {
      disputeId,
      uploadedBy: actorId,
      type: format.type,
      description: explanation,
      fileName: cleanDisplayName(file.originalname, format.extension),
      storageKey: path.basename(file.filename),
      mimeType: format.mimeType,
      fileSize: stat.size,
      fileHash: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
    return publicEvidence(evidenceRepository.createEvidence(metadata));
  } catch (error) {
    await removeStoredFile(file.path);
    throw error;
  }
}

function listEvidence(disputeId, actorId) {
  getAuthorizedDispute(disputeId, actorId);
  return evidenceRepository.getEvidenceByDisputeId(disputeId).map(publicEvidence);
}

function getEvidenceFile(disputeId, evidenceId, actorId) {
  getAuthorizedDispute(disputeId, actorId);
  const evidence = evidenceRepository.getEvidenceById(evidenceId);
  if (evidence.disputeId !== disputeId) throw new NotFoundError('Dispute evidence', evidenceId);
  if (!/^[a-f0-9-]+\.(pdf|jpe?g|png)$/.test(evidence.storageKey)) throw new NotFoundError('Evidence file', evidenceId);
  const filePath = path.resolve(STORAGE_DIR, evidence.storageKey);
  if (path.dirname(filePath) !== STORAGE_DIR) throw new NotFoundError('Evidence file', evidenceId);
  try {
    if (!fs.lstatSync(filePath).isFile()) throw new NotFoundError('Evidence file', evidenceId);
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    if (error.code === 'ENOENT') throw new NotFoundError('Evidence file', evidenceId);
    throw error;
  }
  return { evidence: publicEvidence(evidence), filePath };
}

module.exports = { uploadEvidence, listEvidence, getEvidenceFile, removeStoredFile, identifyEvidence };
