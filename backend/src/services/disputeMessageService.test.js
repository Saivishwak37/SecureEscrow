const request = require('supertest');
const app = require('../app');
const { getStore } = require('../data/store');
const escrowRepository = require('../repositories/escrowRepository');
const disputeService = require('./disputeService');
const transactionRepository = require('../repositories/transactionRepository');
const { authAs } = require('../testUtils/auth');

const api = (method, path, userId) => authAs(request(app)[method](path), userId);

function setup() {
  const escrow = escrowRepository.createEscrow({
    title: 'Test agreement', clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100,
    releaseModel: 'MILESTONE_BASED', participants: [{ userId: 'user-1', role: 'PAYER' }, { userId: 'user-2', role: 'PAYEE' }],
  });
  const dispute = disputeService.createDispute(escrow.id, 'user-1', {
    title: 'Service issue', description: 'Work is incomplete.', category: 'INCOMPLETE_DELIVERY', requestedResolution: 'OTHER',
  });
  return { escrow, dispute };
}

describe('dispute messages', () => {
  beforeEach(() => getStore().reset());

  test('client and provider can create immutable messages with sender information', async () => {
    const { dispute } = setup();
    const client = await api('post', `/api/disputes/${dispute.id}/messages`, 'user-1').send({ actorId: 'user-1', message: 'Client message' });
    const provider = await api('post', `/api/disputes/${dispute.id}/messages`, 'user-2').send({ actorId: 'user-2', message: 'Provider message' });
    expect(client.status).toBe(201);
    expect(client.body.data).toMatchObject({ disputeId: dispute.id, senderId: 'user-1', message: 'Client message', sender: { name: 'Test Client', type: 'CLIENT' } });
    expect(provider.status).toBe(201);
    expect(provider.body.data.sender.type).toBe('PROVIDER');
    expect(getStore().disputeMessages).toHaveLength(2);
  });

  test.each(['', '   \n\t'])('rejects empty message %j', async message => {
    const { dispute } = setup();
    const response = await api('post', `/api/disputes/${dispute.id}/messages`, 'user-1').send({ actorId: 'user-1', message });
    expect(response.status).toBe(400);
  });

  test('rejects messages beyond the configured length', async () => {
    const { dispute } = setup();
    const response = await api('post', `/api/disputes/${dispute.id}/messages`, 'user-1').send({ actorId: 'user-1', message: 'x'.repeat(5001) });
    expect(response.status).toBe(400);
  });

  test('rejects nonexistent disputes and nonparticipants', async () => {
    expect((await api('post', '/api/disputes/missing/messages', 'user-1').send({ actorId: 'user-1', message: 'Hi' })).status).toBe(404);
    const { dispute } = setup();
    expect((await api('post', `/api/disputes/${dispute.id}/messages`, 'outsider').send({ actorId: 'outsider', message: 'Hi' })).status).toBe(403);
  });

  test('returns chronological messages and rejects unauthorized retrieval', async () => {
    const { dispute } = setup();
    const first = await api('post', `/api/disputes/${dispute.id}/messages`, 'user-1').send({ actorId: 'user-1', message: 'First' });
    const second = await api('post', `/api/disputes/${dispute.id}/messages`, 'user-2').send({ actorId: 'user-2', message: 'Second' });
    const response = await api('get', `/api/disputes/${dispute.id}/messages?actorId=user-1`, 'user-1');
    expect(response.status).toBe(200);
    expect(response.body.data.map(item => item.message)).toEqual(['First', 'Second']);
    expect(first.body.data.createdAt).toBeLessThanOrEqual(second.body.data.createdAt);
    expect((await api('get', `/api/disputes/${dispute.id}/messages?actorId=outsider`, 'outsider')).status).toBe(403);
  });

  test('allows admin retrieval but not message sending', async () => {
    const { dispute } = setup();
    expect((await api('post', `/api/disputes/${dispute.id}/messages`, 'user-admin').send({ actorId: 'user-admin', message: 'Admin note' })).status).toBe(403);
    expect((await api('get', `/api/disputes/${dispute.id}/messages`, 'user-admin')).status).toBe(200);
  });

  test('blocks terminal disputes and does not affect escrow or financial records', async () => {
    const { escrow, dispute } = setup();
    dispute.status = 'RESOLVED';
    const before = { status: escrow.status, disputed: escrow.disputed, transactions: getStore().transactions.length, ledgers: getStore().ledgerEntries.length };
    expect((await api('post', `/api/disputes/${dispute.id}/messages`, 'user-1').send({ actorId: 'user-1', message: 'After close' })).status).toBe(400);
    expect({ status: escrow.status, disputed: escrow.disputed, transactions: getStore().transactions.length, ledgers: getStore().ledgerEntries.length }).toEqual(before);
    expect(transactionRepository.getTransactionsByEscrowId(escrow.id)).toHaveLength(0);
  });
});
