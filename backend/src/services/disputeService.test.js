const request = require('supertest');
const app = require('../app');
const { getStore } = require('../data/store');
const escrowRepository = require('../repositories/escrowRepository');
const milestoneRepository = require('../repositories/milestoneRepository');
const escrowStatusHistoryRepository = require('../repositories/escrowStatusHistoryRepository');
const disputeService = require('./disputeService');
const escrowService = require('./escrowService');
const transactionService = require('./transactionService');
const transactionRepository = require('../repositories/transactionRepository');
const ledgerService = require('./ledgerService');
const { authAs } = require('../testUtils/auth');

const payload = {
  actorId: 'user-1', title: 'Delivery has not arrived', category: 'NON_DELIVERY',
  description: 'The agreed item was not delivered.', requestedResolution: 'REFUND_TO_CLIENT',
};

function createEscrow(releaseModel = 'MILESTONE_BASED') {
  return escrowRepository.createEscrow({
    title: 'Test agreement', clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100,
    releaseModel, participants: [{ userId: 'user-1', role: 'PAYER' }, { userId: 'user-2', role: 'PAYEE' }],
  });
}

describe('POST /api/escrows/:escrowId/disputes', () => {
  beforeEach(() => getStore().reset());

  test('creates an OPEN dispute, freezes escrow, records history, and creates no financial entry', async () => {
    const escrow = createEscrow();
    const ledgerCount = getStore().ledgerEntries.length;
    const response = await authAs(request(app).post(`/api/escrows/${escrow.id}/disputes`), 'user-1').send(payload);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      escrowId: escrow.id, raisedBy: 'user-1', title: payload.title,
      category: payload.category, requestedResolution: payload.requestedResolution,
      status: 'OPEN', milestoneId: null, reason: payload.description,
    });
    expect(escrowRepository.getEscrowById(escrow.id).disputed).toBe(true);
    expect(escrowRepository.getEscrowById(escrow.id).status).toBe('DISPUTED');
    expect(escrowStatusHistoryRepository.getEscrowStatusHistory(escrow.id)).toMatchObject([
      { escrowId: escrow.id, changedBy: 'user-1', fromStatus: 'CREATED', toStatus: 'DISPUTED' },
    ]);
    expect(getStore().ledgerEntries).toHaveLength(ledgerCount);
    expect(getStore().transactions).toHaveLength(0);
  });

  test('rejects missing required fields', async () => {
    const escrow = createEscrow();
    const response = await authAs(request(app).post(`/api/escrows/${escrow.id}/disputes`), 'user-1').send({ actorId: 'user-1' });
    expect(response.status).toBe(400);
    expect(escrow.status).toBe('CREATED');
    expect(disputeService.getDisputesByEscrow(escrow.id)).toHaveLength(0);
  });

  test('returns 404 for a nonexistent escrow', async () => {
    const response = await authAs(request(app).post('/api/escrows/missing/disputes'), 'user-1').send(payload);
    expect(response.status).toBe(404);
  });

  test('rejects a requester who is not an escrow participant', async () => {
    const escrow = createEscrow();
    const response = await authAs(request(app).post(`/api/escrows/${escrow.id}/disputes`), 'user-admin').send({ ...payload, actorId: 'user-admin' });
    expect(response.status).toBe(403);
  });

  test('rejects milestone references from another escrow', async () => {
    const escrow = createEscrow();
    const otherEscrow = createEscrow();
    const milestone = milestoneRepository.createMilestone({ escrowId: otherEscrow.id, title: 'Other', amount: 100 });
    const response = await authAs(request(app).post(`/api/escrows/${escrow.id}/disputes`), 'user-1').send({ ...payload, milestoneId: milestone.id });
    expect(response.status).toBe(400);
  });

  test('allows condition-based escrow disputes without a milestone', async () => {
    const escrow = createEscrow('CONDITION_BASED');
    const response = await authAs(request(app).post(`/api/escrows/${escrow.id}/disputes`), 'user-1').send(payload);
    expect(response.status).toBe(201);
    expect(response.body.data.milestoneId).toBeNull();
  });

  test('rejects a second active dispute for the escrow', async () => {
    const escrow = createEscrow();
    const first = await authAs(request(app).post(`/api/escrows/${escrow.id}/disputes`), 'user-1').send(payload);
    const second = await authAs(request(app).post(`/api/escrows/${escrow.id}/disputes`), 'user-1').send(payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(escrowStatusHistoryRepository.getEscrowStatusHistory(escrow.id)).toHaveLength(1);
  });

  test('returns disputes for the escrow', async () => {
    const escrow = createEscrow();
    await authAs(request(app).post(`/api/escrows/${escrow.id}/disputes`), 'user-1').send(payload);
    const response = await authAs(request(app).get(`/api/escrows/${escrow.id}/disputes`), 'user-1');
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  test('rolls back the dispute if the escrow status transition fails', () => {
    const escrow = createEscrow();
    const transition = jest.spyOn(getStore(), 'update').mockImplementation(() => { throw new Error('transition failed'); });
    expect(() => disputeService.createDispute(escrow.id, 'user-1', payload)).toThrow('transition failed');
    transition.mockRestore();
    expect(escrow.status).toBe('CREATED');
    expect(disputeService.getDisputesByEscrow(escrow.id)).toHaveLength(0);
    expect(escrowStatusHistoryRepository.getEscrowStatusHistory(escrow.id)).toHaveLength(0);
  });

  test('rejects milestone release, condition release, direct refund transactions, and direct escrow ledger debits while disputed', () => {
    const milestoneEscrow = createEscrow();
    const milestone = milestoneRepository.createMilestone({ escrowId: milestoneEscrow.id, title: 'Delivery', amount: 100 });
    disputeService.createDispute(milestoneEscrow.id, 'user-1', payload);
    expect(() => require('./milestoneService').releaseMilestone(milestone.id, 'user-1')).toThrow(/dispute/i);
    expect(() => transactionService.createTransaction({
      type: 'REFUND', amount: 1, escrowId: milestoneEscrow.id, milestoneId: milestone.id,
      fromAccountId: 'account-escrow', toAccountId: 'account-user-1',
    })).toThrow(/dispute/i);
    expect(() => transactionService.createTransaction({
      type: 'RELEASE', amount: 1, escrowId: milestoneEscrow.id, milestoneId: milestone.id,
      fromAccountId: 'account-escrow', toAccountId: 'account-user-2',
    })).toThrow(/dispute/i);

    const conditionEscrow = escrowService.createEscrow({
      clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100, releaseModel: 'CONDITION_BASED',
      conditions: [{ type: 'DEADLINE_REACHED', deadline: '2020-01-01T00:00:00.000Z' }],
    });
    escrowService.fundEscrow(conditionEscrow.id, null, 'user-1');
    disputeService.createDispute(conditionEscrow.id, 'user-1', payload);
    expect(() => escrowService.releaseConditionEscrow(conditionEscrow.id, 'user-1')).toThrow(/dispute/i);

    const directRefund = transactionRepository.createTransaction({
      type: 'REFUND', amount: 1, status: 'PENDING', escrowId: conditionEscrow.id,
      fromAccountId: 'account-escrow', toAccountId: 'account-user-1',
    });
    expect(() => ledgerService.recordTransaction(directRefund.id, 'account-escrow', 'account-user-1', 1)).toThrow(/dispute/i);
  });

  test('deadline evaluation does not auto-release funds from a disputed escrow', () => {
    const escrow = escrowService.createEscrow({
      clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100, releaseModel: 'CONDITION_BASED',
      conditions: [{ type: 'DEADLINE_REACHED', deadline: '2020-01-01T00:00:00.000Z' }],
    });
    escrowService.fundEscrow(escrow.id, null, 'user-1');
    disputeService.createDispute(escrow.id, 'user-1', payload);
    expect(escrowService.getReleaseEligibility(escrow.id).eligible).toBe(false);
    expect(transactionService.getTransactionsByEscrow(escrow.id).filter(transaction => transaction.type === 'RELEASE')).toHaveLength(0);
  });

  test('concurrent dispute creation and milestone release cannot both succeed in this process', async () => {
    const escrow = createEscrow();
    const milestone = milestoneRepository.createMilestone({ escrowId: escrow.id, title: 'Delivery', amount: 100, status: 'APPROVED' });
    getStore().getEscrowAccount().balance = 100;
    const [disputeResult, releaseResult] = await Promise.all([
      authAs(request(app).post(`/api/escrows/${escrow.id}/disputes`), 'user-1').send(payload),
      authAs(request(app).post(`/api/milestones/${milestone.id}/release`), 'user-1').send({ actorId: 'user-1' }),
    ]);
    expect([disputeResult.status === 201, releaseResult.status === 200]).not.toEqual([true, true]);
    if (disputeResult.status === 201) expect(escrowRepository.getEscrowById(escrow.id).status).toBe('DISPUTED');
    else expect(disputeResult.status).toBe(400);
  });
});
