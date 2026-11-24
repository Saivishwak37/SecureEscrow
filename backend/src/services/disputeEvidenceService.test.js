const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `secureescrow-evidence-test-${process.pid}`);
process.env.DISPUTE_EVIDENCE_STORAGE_DIR = TEST_STORAGE_DIR;

const request = require('supertest');
const app = require('../app');
const { getStore } = require('../data/store');
const escrowRepository = require('../repositories/escrowRepository');
const disputeService = require('./disputeService');
const evidenceRepository = require('../repositories/disputeEvidenceRepository');
const { MAX_EVIDENCE_FILE_SIZE } = require('../middleware/disputeEvidenceUpload');
const { authAs } = require('../testUtils/auth');

const disputeInput = {
  title: 'Delivery issue', category: 'NON_DELIVERY', description: 'The agreed item did not arrive.', requestedResolution: 'REFUND_TO_CLIENT',
};
const fixtures = {
  pdf: { filename: 'receipt.pdf', contentType: 'application/pdf', bytes: Buffer.from('%PDF-1.7\nSample evidence') },
  png: { filename: 'photo.png', contentType: 'image/png', bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]) },
  jpeg: { filename: 'photo.jpg', contentType: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
};

function createActiveDispute() {
  const escrow = escrowRepository.createEscrow({
    title: 'Purchase', clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100,
    participants: [{ userId: 'user-1', role: 'PAYER' }, { userId: 'user-2', role: 'PAYEE' }],
  });
  const dispute = disputeService.createDispute(escrow.id, 'user-1', disputeInput);
  return { escrow, dispute };
}

function upload(disputeId, file = fixtures.pdf, actorId = 'user-1', description = '') {
  return authAs(request(app).post(`/api/disputes/${disputeId}/evidence`), actorId)
    .field('actorId', actorId)
    .field('description', description)
    .attach('file', file.bytes, { filename: file.filename, contentType: file.contentType });
}

function storedFiles() {
  if (!fs.existsSync(TEST_STORAGE_DIR)) return [];
  return fs.readdirSync(TEST_STORAGE_DIR);
}

beforeEach(() => {
  getStore().reset();
  fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
});

afterAll(() => fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true }));

describe('dispute evidence upload and retrieval', () => {
  test.each(['pdf', 'png', 'jpeg'])('accepts a valid %s file and persists metadata only', async format => {
    const { escrow, dispute } = createActiveDispute();
    const transactionsBefore = getStore().transactions.length;
    const ledgerBefore = getStore().ledgerEntries.length;
    const response = await upload(dispute.id, fixtures[format], 'user-2', 'Supporting document');

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      disputeId: dispute.id, uploadedBy: 'user-2', description: 'Supporting document',
      mimeType: fixtures[format].contentType, fileName: fixtures[format].filename,
      fileSize: fixtures[format].bytes.length,
    });
    expect(response.body.data.fileHash).toBe(crypto.createHash('sha256').update(fixtures[format].bytes).digest('hex'));
    expect(response.body.data).not.toHaveProperty('storageKey');
    expect(JSON.stringify(response.body)).not.toContain(TEST_STORAGE_DIR);
    expect(getStore().disputeEvidence).toHaveLength(1);
    expect(getStore().disputeEvidence[0]).toHaveProperty('storageKey');
    expect(getStore().disputeEvidence[0]).not.toHaveProperty('data');
    expect(storedFiles()).toHaveLength(1);
    expect(escrowRepository.getEscrowById(escrow.id)).toMatchObject({ status: 'DISPUTED', disputed: true });
    expect(dispute.status).toBe('OPEN');
    expect(getStore().transactions).toHaveLength(transactionsBefore);
    expect(getStore().ledgerEntries).toHaveLength(ledgerBefore);
  });

  test('rejects unsupported extensions and MIME type mismatches', async () => {
    const { dispute } = createActiveDispute();
    const unsupported = await upload(dispute.id, { filename: 'evidence.gif', contentType: 'image/gif', bytes: Buffer.from('GIF89a') });
    const mismatch = await upload(dispute.id, { ...fixtures.pdf, contentType: 'image/png' });
    expect(unsupported.status).toBe(400);
    expect(mismatch.status).toBe(400);
    expect(storedFiles()).toHaveLength(0);
  });

  test('rejects invalid file signatures and empty files', async () => {
    const { dispute } = createActiveDispute();
    const invalid = await upload(dispute.id, { ...fixtures.pdf, bytes: Buffer.from('not a PDF') });
    const empty = await upload(dispute.id, { ...fixtures.pdf, bytes: Buffer.alloc(0) });
    expect(invalid.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(storedFiles()).toHaveLength(0);
  });

  test('rejects files larger than the configured five MB limit', async () => {
    const { dispute } = createActiveDispute();
    const oversized = { ...fixtures.pdf, bytes: Buffer.concat([fixtures.pdf.bytes, Buffer.alloc(MAX_EVIDENCE_FILE_SIZE)]) };
    const response = await upload(dispute.id, oversized);
    expect(response.status).toBe(413);
    expect(storedFiles()).toHaveLength(0);
  });

  test('rejects uploads for missing disputes and nonparticipants', async () => {
    const missing = await upload('missing-dispute');
    const { dispute } = createActiveDispute();
    const nonparticipant = await upload(dispute.id, fixtures.pdf, 'user-admin');
    expect(missing.status).toBe(404);
    expect(nonparticipant.status).toBe(403);
    expect(storedFiles()).toHaveLength(0);
  });

  test('lists evidence chronologically only to participants or admins', async () => {
    const { dispute } = createActiveDispute();
    await upload(dispute.id);
    const denied = await authAs(request(app).get(`/api/disputes/${dispute.id}/evidence?actorId=user-outsider`), 'user-outsider');
    const participant = await authAs(request(app).get(`/api/disputes/${dispute.id}/evidence?actorId=user-2`), 'user-2');
    const admin = await authAs(request(app).get(`/api/disputes/${dispute.id}/evidence?actorId=user-admin`), 'user-admin');
    expect(denied.status).toBe(403);
    expect(participant.status).toBe(200);
    expect(admin.status).toBe(200);
    expect(participant.body.data).toHaveLength(1);
    expect(participant.body.data[0]).not.toHaveProperty('storageKey');
  });

  test('checks authorization on downloads and serves file bytes with safe headers', async () => {
    const { dispute } = createActiveDispute();
    const uploaded = await upload(dispute.id);
    const evidenceId = uploaded.body.data.id;
    const denied = await authAs(request(app).get(`/api/disputes/${dispute.id}/evidence/${evidenceId}/file?actorId=user-outsider`), 'user-outsider');
    const allowed = await authAs(request(app).get(`/api/disputes/${dispute.id}/evidence/${evidenceId}/file?actorId=user-2`), 'user-2');
    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(allowed.headers['content-type']).toContain('application/pdf');
    expect(allowed.headers['content-disposition']).toContain('inline');
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    expect(allowed.body).toEqual(fixtures.pdf.bytes);
  });

  test('rejects path traversal and evidence belonging to another dispute', async () => {
    const first = createActiveDispute();
    const second = createActiveDispute();
    const evidence = evidenceRepository.createEvidence({
      disputeId: first.dispute.id, uploadedBy: 'user-1', type: 'PDF', description: '', fileName: 'a.pdf',
      storageKey: '../../outside.pdf', mimeType: 'application/pdf', fileSize: 12, fileHash: 'hash',
    });
    const traversal = await authAs(request(app).get(`/api/disputes/${first.dispute.id}/evidence/${evidence.id}/file?actorId=user-1`), 'user-1');
    const wrongDispute = await authAs(request(app).get(`/api/disputes/${second.dispute.id}/evidence/${evidence.id}/file?actorId=user-1`), 'user-1');
    expect(traversal.status).toBe(404);
    expect(wrongDispute.status).toBe(404);
  });

  test('preserves multiple uploads and removes a stored file if metadata persistence fails', async () => {
    const { dispute } = createActiveDispute();
    const first = await upload(dispute.id, fixtures.pdf);
    const second = await upload(dispute.id, fixtures.png, 'user-2');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(evidenceRepository.getEvidenceByDisputeId(dispute.id)).toHaveLength(2);
    expect(storedFiles()).toHaveLength(2);

    const another = createActiveDispute();
    const create = jest.spyOn(evidenceRepository, 'createEvidence').mockImplementation(() => { throw new Error('metadata write failed'); });
    const failed = await upload(another.dispute.id);
    create.mockRestore();
    expect(failed.status).toBe(500);
    expect(storedFiles()).toHaveLength(2);
  });

  test('rejects evidence for a terminal dispute', async () => {
    const { dispute } = createActiveDispute();
    getStore().findById('disputes', dispute.id).status = 'RESOLVED';
    const response = await upload(dispute.id);
    expect(response.status).toBe(400);
    expect(storedFiles()).toHaveLength(0);
  });
});
