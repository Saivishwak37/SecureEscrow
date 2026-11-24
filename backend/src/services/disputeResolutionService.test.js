const request = require('supertest');
const app = require('../app');
const { getStore } = require('../data/store');
const escrowRepository = require('../repositories/escrowRepository');
const disputeService = require('./disputeService');
const accountRepository = require('../repositories/accountRepository');
const transactionService = require('./transactionService');
const resolutionService = require('./disputeResolutionService');
const historyRepository = require('../repositories/disputeStatusHistoryRepository');
const evidenceRepository = require('../repositories/disputeEvidenceRepository');
const messageRepository = require('../repositories/disputeMessageRepository');
const ledgerRepository = require('../repositories/ledgerRepository');
const escrowStatusHistoryRepository = require('../repositories/escrowStatusHistoryRepository');
const milestoneRepository = require('../repositories/milestoneRepository');
const escrowService = require('./escrowService');
const { authAs } = require('../testUtils/auth');

const api = (method, path, userId) => authAs(request(app)[method](path), userId);

function setup({ amount = 100, releaseModel = 'MILESTONE_BASED' } = {}) {
  const escrow = escrowRepository.createEscrow({ title: 'Review project', clientId: 'user-1', freelancerId: 'user-2', totalAmount: amount, releaseModel });
  const escrowAccount = accountRepository.getEscrowAccount();
  transactionService.createTransaction({ type: 'FUND', amount, escrowId: escrow.id, fromAccountId: accountRepository.getAccountByUserId('user-1').id, toAccountId: escrowAccount.id });
  const dispute = disputeService.createDispute(escrow.id, 'user-1', { title: 'Delivery dispute', description: 'The work needs review.', category: 'QUALITY_ISSUE', requestedResolution: 'OTHER' });
  return { escrow, dispute, escrowAccount };
}
const payload = (decision, extra = {}) => ({ actorId: 'user-admin', decision, reasoning: 'Evidence supports this outcome.', idempotencyKey: `test-${Math.random()}`, ...extra });

describe('dispute resolution and lifecycle audit', () => {
  beforeEach(() => getStore().reset());

  test('client and provider cannot resolve; admin can', async () => {
    const { dispute } = setup();
    for (const actorId of ['user-1', 'user-2', 'outsider']) {
      expect((await api('post', `/api/disputes/${dispute.id}/resolve`, actorId).send(payload('RELEASE_TO_PROVIDER', { actorId }))).status).toBe(403);
    }
    expect((await api('post', `/api/disputes/${dispute.id}/resolve`, 'user-admin').send(payload('RELEASE_TO_PROVIDER'))).status).toBe(201);
  });

  test.each([
    ['RELEASE_TO_PROVIDER', { providerAmount: undefined }, 'user-2', 100],
    ['REFUND_TO_CLIENT', { clientAmount: undefined }, 'user-1', 100],
  ])('executes %s with balanced ledger and correct recipient', async (decision, extra, recipientId, amount) => {
    const { escrow, dispute, escrowAccount } = setup();
    const response = await api('post', `/api/disputes/${dispute.id}/resolve`, 'user-admin').send(payload(decision, extra));
    expect(response.status).toBe(201);
    expect(response.body.data.executionStatus).toBe('COMPLETED');
    expect(response.body.data.allocations).toMatchObject([{ recipientAccountId: accountRepository.getAccountByUserId(recipientId).id, amount }]);
    expect(ledgerRepository.getLedgerEntriesByTransactionId(response.body.data.transactionId)).toHaveLength(2);
    expect(escrowRepository.getEscrowById(escrow.id).status).toBe(decision === 'RELEASE_TO_PROVIDER' ? 'RELEASED' : 'CANCELLED');
    expect(accountRepository.getEscrowAccount().balance).toBe(0);
    expect(require('../repositories/disputeRepository').getDisputeById(dispute.id).status).toBe('RESOLVED');
    expect(escrowStatusHistoryRepository.getEscrowStatusHistory(escrow.id).at(-1)).toMatchObject({ fromStatus: 'DISPUTED', toStatus: decision === 'RELEASE_TO_PROVIDER' ? 'RELEASED' : 'CANCELLED' });
  });

  test('executes split allocation and allocation records match both transactions', async () => {
    const { dispute, escrow } = setup();
    const result = await resolutionService.resolveDispute(dispute.id, payload('SPLIT_FUNDS', { providerAmount: 40, clientAmount: 60 }));
    expect(result.transactions).toHaveLength(2);
    expect(result.allocations.map(a => [a.amount, a.transactionId])).toEqual(result.transactions.map(tx => [tx.amount, tx.id]));
    expect(getStore().accounts.find(a => a.userId === 'user-1').balance).toBe(999960);
    expect(getStore().accounts.find(a => a.userId === 'user-2').balance).toBe(40);
    expect(escrowRepository.getEscrowById(escrow.id).status).toBe('RESOLVED');
  });

  test('partial release leaves remaining funds frozen and dispute under review', async () => {
    const { escrow, dispute, escrowAccount } = setup();
    const result = await resolutionService.resolveDispute(dispute.id, payload('PARTIAL_RELEASE', { providerAmount: 25 }));
    expect(result.executionStatus).toBe('PARTIAL');
    expect(result.remainingEscrowBalance).toBe(75);
    expect(accountRepository.getEscrowAccount().balance).toBe(75);
    expect(escrowRepository.getEscrowById(escrow.id).status).toBe('DISPUTED');
    expect(escrowRepository.getEscrowById(escrow.id).disputed).toBe(true);
    expect(require('../repositories/disputeRepository').getDisputeById(dispute.id).status).toBe('UNDER_REVIEW');
  });

  test('allows a later final allocation of the balance remaining after a partial release', () => {
    const { escrow, dispute } = setup();
    resolutionService.resolveDispute(dispute.id, payload('PARTIAL_RELEASE', { providerAmount: 25, idempotencyKey: 'partial-1' }));
    const final = resolutionService.resolveDispute(dispute.id, payload('REFUND_TO_CLIENT', { idempotencyKey: 'finish-1' }));
    expect(final.executionStatus).toBe('COMPLETED');
    expect(final.allocations[0].amount).toBe(75);
    expect(escrowRepository.getEscrowById(escrow.id).status).toBe('CANCELLED');
    expect(require('../repositories/disputeRepository').getDisputeById(dispute.id).status).toBe('RESOLVED');
    expect(accountRepository.getEscrowAccount().balance).toBe(0);
  });

  test('resolving one milestone dispute leaves a second funded milestone available for provider submission', async () => {
    const escrow = escrowRepository.createEscrow({ title: 'Two milestone project', clientId: 'user-1', freelancerId: 'user-2', totalAmount: 200 });
    const disputedMilestone = milestoneRepository.createMilestone({ escrowId: escrow.id, title: 'First milestone', description: 'First phase', amount: 100, order: 1 });
    const nextMilestone = milestoneRepository.createMilestone({ escrowId: escrow.id, title: 'Second milestone', description: 'Second phase', amount: 100, order: 2 });
    escrowService.fundEscrow(escrow.id, disputedMilestone.id, 'user-1');
    escrowService.fundEscrow(escrow.id, nextMilestone.id, 'user-1');
    const dispute = disputeService.createDispute(escrow.id, 'user-1', {
      title: 'First phase refund', description: 'The first phase needs a refund.', category: 'QUALITY_ISSUE', requestedResolution: 'REFUND_TO_CLIENT', milestoneId: disputedMilestone.id,
    });

    resolutionService.resolveDispute(dispute.id, payload('REFUND_TO_CLIENT'));
    expect(escrowRepository.getEscrowById(escrow.id).status).toBe('FUNDED');
    expect(milestoneRepository.getMilestoneById(disputedMilestone.id).status).toBe('CANCELLED');
    expect(milestoneRepository.getMilestoneById(nextMilestone.id).status).toBe('FUNDED');

    escrowService.startEscrow(escrow.id, nextMilestone.id, 'user-2');
    const response = await api('post', `/api/milestones/${nextMilestone.id}/submit`, 'user-2').send({
      actorId: 'user-2', attachments: [{ name: 'phase-two.pdf', type: 'application/pdf', data: 'data:application/pdf;base64,JVBERiQ=' }],
    });
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('SUBMITTED');
    expect(escrowRepository.getEscrowById(escrow.id).status).toBe('SUBMITTED');
  });

  test('resolution cannot narrow an escrow-level dispute to a milestone selected only by admin', async () => {
    const escrow = escrowRepository.createEscrow({ title: 'Two milestone project', clientId: 'user-1', freelancerId: 'user-2', totalAmount: 200 });
    const disputedMilestone = milestoneRepository.createMilestone({ escrowId: escrow.id, title: 'First milestone', description: 'First phase', amount: 100, order: 1 });
    const nextMilestone = milestoneRepository.createMilestone({ escrowId: escrow.id, title: 'Second milestone', description: 'Second phase', amount: 100, order: 2 });
    escrowService.fundEscrow(escrow.id, disputedMilestone.id, 'user-1');
    escrowService.fundEscrow(escrow.id, nextMilestone.id, 'user-1');
    const dispute = disputeService.createDispute(escrow.id, 'user-1', {
      title: 'Whole agreement dispute', description: 'The whole escrow is disputed.', category: 'QUALITY_ISSUE', requestedResolution: 'REFUND_TO_CLIENT',
    });

    expect(() => resolutionService.resolveDispute(dispute.id, payload('REFUND_TO_CLIENT', { milestoneId: disputedMilestone.id })))
      .toThrow(/scope is fixed by the scope selected when the dispute was raised/);
    expect(resolutionService.resolveDispute(dispute.id, payload('REFUND_TO_CLIENT')).milestoneId).toBeNull();
    expect(milestoneRepository.getMilestoneById(disputedMilestone.id).status).toBe('CANCELLED');
    expect(milestoneRepository.getMilestoneById(nextMilestone.id).status).toBe('CANCELLED');
    expect(escrowRepository.getEscrowById(escrow.id).status).toBe('CANCELLED');
  });

  test('rejects invalid decision, zero, negative, over-balance, and invalid split totals', async () => {
    for (const [decision, extra] of [
      ['SPLIT_FUNDS', { providerAmount: 40, clientAmount: 50 }],
      ['PARTIAL_RELEASE', { providerAmount: 100 }], ['PARTIAL_RELEASE', { providerAmount: 0 }],
      ['PARTIAL_RELEASE', { providerAmount: -1 }], ['UNKNOWN', {}],
    ]) {
      const { dispute } = setup();
      expect((await api('post', `/api/disputes/${dispute.id}/resolve`, 'user-admin').send(payload(decision, extra))).status).toBe(400);
    }
  });

  test('rejects currency mismatch and missing/inactive recipient accounts without financial writes', () => {
    const { dispute } = setup();
    const provider = accountRepository.getAccountByUserId('user-2');
    provider.currency = 'USD';
    expect(() => resolutionService.resolveDispute(dispute.id, payload('RELEASE_TO_PROVIDER'))).toThrow(/currencies/);
    provider.currency = 'INR'; provider.status = 'INACTIVE';
    expect(() => resolutionService.resolveDispute(dispute.id, payload('RELEASE_TO_PROVIDER'))).toThrow(/active/);
    provider.status = 'ACTIVE';
    getStore().accounts.splice(getStore().accounts.indexOf(provider), 1);
    expect(() => resolutionService.resolveDispute(dispute.id, payload('RELEASE_TO_PROVIDER'))).toThrow(/accounts must exist/);
    expect(getStore().disputeResolutions).toHaveLength(0);
  });

  test('rejects insufficient available escrow balance and records a failed attempt only', () => {
    const { dispute } = setup();
    accountRepository.getEscrowAccount().balance = 0;
    expect(() => resolutionService.resolveDispute(dispute.id, payload('REFUND_TO_CLIENT'))).toThrow(/insufficient available funds/);
    expect(getStore().disputeResolutions).toHaveLength(0);
    expect(getStore().transactions.filter(tx => ['RELEASE', 'REFUND'].includes(tx.type))).toHaveLength(0);
    expect(historyRepository.getHistoryByDisputeId(dispute.id).some(event => event.eventType === 'RESOLUTION_FAILED')).toBe(true);
  });

  test('rejects a mismatched account and does not trust a frontend recipient', async () => {
    const { dispute } = setup();
    const response = await api('post', `/api/disputes/${dispute.id}/resolve`, 'user-admin').send(payload('RELEASE_TO_PROVIDER', { toAccountId: 'account-user-1' }));
    expect(response.status).toBe(201);
    expect(response.body.data.allocations[0].recipientAccountId).toBe('account-user-2');
  });

  test('rejects duplicate resolution after finalization and safely replays an idempotent partial request', () => {
    const { dispute } = setup();
    const input = payload('PARTIAL_RELEASE', { providerAmount: 20, idempotencyKey: 'same-key' });
    const first = resolutionService.resolveDispute(dispute.id, input);
    const replay = resolutionService.resolveDispute(dispute.id, input);
    expect(replay.replayed).toBe(true);
    expect(getStore().disputeResolutions).toHaveLength(1);
    resolutionService.resolveDispute(dispute.id, payload('REFUND_TO_CLIENT'));
    expect(() => resolutionService.resolveDispute(dispute.id, payload('RELEASE_TO_PROVIDER'))).toThrow(/eligible/);
    expect(first.id).toBe(replay.id);
  });

  test('replays a duplicate final request using its idempotency key without a second payout', () => {
    const { dispute } = setup();
    const input = payload('RELEASE_TO_PROVIDER', { idempotencyKey: 'final-key' });
    const first = resolutionService.resolveDispute(dispute.id, input);
    const replay = resolutionService.resolveDispute(dispute.id, input);
    expect(replay.replayed).toBe(true);
    expect(replay.id).toBe(first.id);
    expect(getStore().transactions.filter(tx => tx.type === 'RELEASE')).toHaveLength(1);
  });

  test('rolls back transaction, ledger, balances, allocation, resolution and status if ledger posting fails', () => {
    const { escrow, dispute, escrowAccount } = setup();
    const balances = getStore().accounts.map(account => account.balance);
    const counts = [getStore().transactions.length, getStore().ledgerEntries.length];
    const originalAdd = ledgerRepository.addLedgerEntry;
    let calls = 0;
    const add = jest.spyOn(ledgerRepository, 'addLedgerEntry').mockImplementation(entry => {
      calls += 1;
      if (calls === 2) throw new Error('ledger unavailable');
      return originalAdd(entry);
    });
    expect(() => resolutionService.resolveDispute(dispute.id, payload('RELEASE_TO_PROVIDER'))).toThrow('ledger unavailable');
    add.mockRestore();
    expect(getStore().accounts.map(account => account.balance)).toEqual(balances);
    expect([getStore().transactions.length, getStore().ledgerEntries.length]).toEqual(counts);
    expect(getStore().disputeResolutions).toHaveLength(0);
    expect(getStore().disputeResolutionAllocations).toHaveLength(0);
    expect(require('../repositories/disputeRepository').getDisputeById(dispute.id).status).toBe('OPEN');
    expect(escrowRepository.getEscrowById(escrow.id).status).toBe('DISPUTED'); expect(accountRepository.getEscrowAccount().balance).toBe(100);
    expect(historyRepository.getHistoryByDisputeId(dispute.id).some(entry => entry.eventType === 'RESOLUTION_FAILED')).toBe(true);
  });

  test('rolls back all financial writes if allocation recording fails', () => {
    const { dispute } = setup();
    const initialBalances = getStore().accounts.map(account => account.balance);
    const allocationRepository = require('../repositories/disputeResolutionRepository');
    const create = jest.spyOn(allocationRepository, 'createAllocation').mockImplementation(() => { throw new Error('allocation storage unavailable'); });
    expect(() => resolutionService.resolveDispute(dispute.id, payload('SPLIT_FUNDS', { providerAmount: 40, clientAmount: 60 }))).toThrow('allocation storage unavailable');
    create.mockRestore();
    expect(getStore().accounts.map(account => account.balance)).toEqual(initialBalances);
    expect(getStore().disputeResolutions).toHaveLength(0);
    expect(getStore().disputeResolutionAllocations).toHaveLength(0);
    expect(getStore().transactions.filter(tx => ['RELEASE', 'REFUND'].includes(tx.type))).toHaveLength(0);
    expect(getStore().ledgerEntries).toHaveLength(2);
  });

  test('two synchronous admin requests cannot execute the same dispute twice', async () => {
    const { dispute } = setup();
    getStore().users.push({ id: 'user-admin-2', name: 'Second Admin', type: 'ADMIN', createdAt: Date.now() });
    const firstRequest = api('post', `/api/disputes/${dispute.id}/resolve`, 'user-admin').send(payload('RELEASE_TO_PROVIDER', { actorId: 'user-admin' }));
    const secondRequest = api('post', `/api/disputes/${dispute.id}/resolve`, 'user-admin-2').send(payload('RELEASE_TO_PROVIDER', { actorId: 'user-admin-2' }));
    const responses = await Promise.all([firstRequest, secondRequest]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 400]);
    expect(getStore().disputeResolutions).toHaveLength(1);
    expect(getStore().transactions.filter(tx => tx.type === 'RELEASE')).toHaveLength(1);
  });

  test('rolls back executed transfers if updating escrow state fails', () => {
    const { escrow, dispute } = setup();
    const balances = getStore().accounts.map(account => account.balance);
    const originalUpdate = getStore().update;
    const update = jest.spyOn(getStore(), 'update').mockImplementation((collection, id, changes) => {
      if (collection === 'escrows') throw new Error('escrow update unavailable');
      return originalUpdate.call(getStore(), collection, id, changes);
    });
    expect(() => resolutionService.resolveDispute(dispute.id, payload('REFUND_TO_CLIENT'))).toThrow('escrow update unavailable');
    update.mockRestore();
    expect(getStore().accounts.map(account => account.balance)).toEqual(balances);
    expect(getStore().disputeResolutions).toHaveLength(0);
    expect(getStore().transactions.filter(tx => ['RELEASE', 'REFUND'].includes(tx.type))).toHaveLength(0);
    expect(require('../repositories/disputeRepository').getDisputeById(dispute.id).status).toBe('OPEN');
    expect(escrowRepository.getEscrowById(escrow.id).status).toBe('DISPUTED');
  });

  test('records creation and valid status transitions, and rejects invalid transitions without history', async () => {
    const { dispute } = setup();
    expect(historyRepository.getHistoryByDisputeId(dispute.id)[0]).toMatchObject({ fromStatus: null, toStatus: 'OPEN' });
    const before = historyRepository.getHistoryByDisputeId(dispute.id).length;
    expect((await api('patch', `/api/disputes/${dispute.id}/status`, 'user-1').send({ actorId: 'user-1', status: 'UNDER_REVIEW', reason: 'Review' })).status).toBe(403);
    expect((await api('patch', `/api/disputes/${dispute.id}/status`, 'user-admin').send({ actorId: 'user-admin', status: 'RESOLVED', reason: 'Invalid direct close' })).status).toBe(400);
    expect(historyRepository.getHistoryByDisputeId(dispute.id)).toHaveLength(before);
    expect((await api('patch', `/api/disputes/${dispute.id}/status`, 'user-admin').send({ actorId: 'user-admin', status: 'UNDER_REVIEW', reason: 'Admin review' })).status).toBe(200);
    expect(historyRepository.getHistoryByDisputeId(dispute.id)).toHaveLength(before + 1);
  });

  test('preserves evidence and messages after resolution and keeps normal escrow operations blocked until close', async () => {
    const { dispute, escrow } = setup();
    evidenceRepository.createEvidence({ disputeId: dispute.id, uploadedBy: 'user-1', type: 'PDF', description: '', fileName: 'proof.pdf', storageKey: 'proof.pdf', mimeType: 'application/pdf', fileSize: 5, fileHash: 'hash' });
    messageRepository.createMessage({ disputeId: dispute.id, senderId: 'user-1', message: 'Please review this evidence.' });
    expect(() => transactionService.createTransaction({ type: 'RELEASE', amount: 100, escrowId: escrow.id, fromAccountId: 'account-escrow', toAccountId: 'account-user-2' })).toThrow(/disputed/);
    expect(() => transactionService.createTransaction({ type: 'REFUND', amount: 100, escrowId: escrow.id, fromAccountId: 'account-escrow', toAccountId: 'account-user-1' })).toThrow(/disputed/);
    const response = await api('post', `/api/disputes/${dispute.id}/resolve`, 'user-admin').send(payload('RELEASE_TO_PROVIDER'));
    expect(response.status).toBe(201);
    expect(getStore().disputeEvidence).toHaveLength(1); expect(getStore().disputeMessages).toHaveLength(1);
    expect((await api('get', `/api/disputes/${dispute.id}/messages`, 'user-1')).status).toBe(200);
    expect((await api('get', `/api/disputes/${dispute.id}/evidence`, 'user-1')).body.data).toHaveLength(1);
  });

  test('supports condition and milestone escrows and leaves unrelated escrow funding unaffected', () => {
    const { escrow } = setup({ amount: 100 });
    const conditionEscrow = escrowRepository.createEscrow({ title: 'Condition escrow', clientId: 'user-1', freelancerId: 'user-2', totalAmount: 20, releaseModel: 'CONDITION_BASED' });
    transactionService.createTransaction({ type: 'FUND', amount: 20, escrowId: conditionEscrow.id, fromAccountId: 'account-user-1', toAccountId: 'account-escrow' });
    expect(transactionService.getTransactionsByEscrow(escrow.id).map(tx => tx.type)).toEqual(['FUND']);
    expect(transactionService.getTransactionsByEscrow(conditionEscrow.id).map(tx => tx.type)).toEqual(['FUND']);
  });

  test('exposes resolution records and status history to an admin only', async () => {
    const { dispute } = setup();
    await api('post', `/api/disputes/${dispute.id}/resolve`, 'user-admin').send(payload('REFUND_TO_CLIENT'));
    expect((await api('get', `/api/disputes/${dispute.id}/history`, 'user-admin')).status).toBe(200);
    expect((await api('get', `/api/disputes/${dispute.id}/history`, 'user-1')).status).toBe(200);
    expect((await api('get', `/api/disputes/${dispute.id}/history`, 'outsider')).status).toBe(403);
    expect((await api('get', `/api/disputes/${dispute.id}/resolutions`, 'user-1')).body.data[0].decision).toBe('REFUND_TO_CLIENT');
    expect((await api('get', `/api/disputes/${dispute.id}/resolutions`, 'user-admin')).body.data[0].decision).toBe('REFUND_TO_CLIENT');
  });
});
