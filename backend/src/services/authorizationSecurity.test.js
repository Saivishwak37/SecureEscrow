const request = require('supertest');
const app = require('../app');
const { getStore } = require('../data/store');
const escrowRepository = require('../repositories/escrowRepository');
const disputeService = require('./disputeService');
const { authAs } = require('../testUtils/auth');

function createDispute() {
  const escrow = escrowRepository.createEscrow({
    title: 'Private agreement', clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100,
    participants: [{ userId: 'user-1', role: 'PAYER' }, { userId: 'user-2', role: 'PAYEE' }],
  });
  const dispute = disputeService.createDispute(escrow.id, 'user-1', {
    title: 'Delivery issue', category: 'NON_DELIVERY', description: 'Not received', requestedResolution: 'REFUND_TO_CLIENT',
  });
  return { escrow, dispute };
}

describe('business API authentication and resource authorization', () => {
  beforeEach(() => getStore().reset());

  test('requires a valid bearer identity on all business routers', async () => {
    for (const path of ['/api/users', '/api/accounts/user/user-1', '/api/escrows', '/api/milestones/missing', '/api/conditions/missing', '/api/transactions/missing', '/api/disputes/missing/messages']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  test('escrow and dispute reads are limited to current participants', async () => {
    const { escrow, dispute } = createDispute();
    const clientRead = await authAs(request(app).get(`/api/escrows/${escrow.id}`), 'user-1');
    const providerRead = await authAs(request(app).get(`/api/disputes/${dispute.id}/messages`), 'user-2');
    const outsiderRead = await authAs(request(app).get(`/api/escrows/${escrow.id}`), 'outsider');
    expect(clientRead.status).toBe(200);
    expect(providerRead.status).toBe(200);
    expect(outsiderRead.status).toBe(403);
  });

  test('body and query identity fields cannot replace the token identity', async () => {
    const { dispute } = createDispute();
    const bodySpoof = await authAs(request(app).post(`/api/disputes/${dispute.id}/messages`), 'user-1')
      .send({ actorId: 'user-2', message: 'spoof' });
    const querySpoof = await authAs(request(app).get(`/api/disputes/${dispute.id}/messages?actorId=user-2`), 'user-1');
    const matchingIdentity = await authAs(request(app).post(`/api/disputes/${dispute.id}/messages`), 'user-1')
      .send({ actorId: 'user-1', message: 'authenticated' });
    expect(bodySpoof.status).toBe(403);
    expect(querySpoof.status).toBe(403);
    expect(matchingIdentity.status).toBe(201);
    expect(getStore().disputeMessages[0].senderId).toBe('user-1');
  });

  test('personal account IDs cannot be read or funded by another participant', async () => {
    const own = await authAs(request(app).get('/api/accounts/account-user-1'), 'user-1');
    const otherRead = await authAs(request(app).get('/api/accounts/account-user-1'), 'user-2');
    const otherDeposit = await authAs(request(app).post('/api/accounts/account-user-1/deposit'), 'user-2')
      .send({ amount: 10 });
    expect(own.status).toBe(200);
    expect(otherRead.status).toBe(403);
    expect(otherDeposit.status).toBe(403);
    expect(getStore().accounts.find(account => account.id === 'account-user-1').balance).toBe(1000000);
  });

  test('only admins may change dispute status or execute a resolution', async () => {
    const { dispute } = createDispute();
    const client = await authAs(request(app).patch(`/api/disputes/${dispute.id}/status`), 'user-1')
      .send({ actorId: 'user-1', status: 'UNDER_REVIEW', reason: 'request' });
    const admin = await authAs(request(app).patch(`/api/disputes/${dispute.id}/status`), 'user-admin')
      .send({ actorId: 'user-admin', status: 'UNDER_REVIEW', reason: 'review' });
    expect(client.status).toBe(403);
    expect(admin.status).toBe(200);
  });
});
