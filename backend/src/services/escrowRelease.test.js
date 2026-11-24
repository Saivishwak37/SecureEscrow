const { getStore } = require('../data/store');
const escrowService = require('./escrowService');
const milestoneService = require('./milestoneService');
const transactionService = require('./transactionService');
const accountRepository = require('../repositories/accountRepository');
const ledgerService = require('./ledgerService');
const escrowRepository = require('../repositories/escrowRepository');
const conditionRepository = require('../repositories/conditionRepository');
const { ValidationError } = require('../utils/errors');

beforeEach(() => getStore().reset());

describe('escrow release models', () => {
  test('milestone agreement validates allocation, then funds, approves and releases exactly once', () => {
    expect(() => escrowService.createEscrow({ clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100, milestones: [{ title: 'Design', description: 'Create designs', amount: 90 }] })).toThrow('Milestone amounts must sum');
    const escrow = escrowService.createEscrow({ title: 'Generic agreement', agreementType: 'equipment sale', clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100, milestones: [{ title: 'Delivery', description: 'Deliver the completed work.', amount: 100 }] });
    const milestone = milestoneService.getMilestonesByEscrow(escrow.id)[0];
    escrowService.fundEscrow(escrow.id, milestone.id, 'user-1');
    milestoneService.updateMilestoneStatus(milestone.id, 'START', 'user-2');
    milestoneService.updateMilestoneStatus(milestone.id, 'SUBMIT', 'user-2', { attachments: [{ name: 'delivery.txt', type: 'text/plain', data: 'data:text/plain;base64,ZGVsaXZlcnk=' }] });
    milestoneService.updateMilestoneStatus(milestone.id, 'REVIEW', 'user-1');
    milestoneService.updateMilestoneStatus(milestone.id, 'APPROVE', 'user-1');
    const result = milestoneService.releaseMilestone(milestone.id, 'user-1');
    expect(result.transaction.status).toBe('COMPLETED');
    expect(() => milestoneService.releaseMilestone(milestone.id, 'user-1')).toThrow();
    expect(accountRepository.getAccountByUserId('user-2').balance).toBe(100);
    expect(ledgerService.getLedgerEntriesByTransaction(result.transaction.id).map(entry => entry.type).sort()).toEqual(['CREDIT', 'DEBIT']);
    expect(ledgerService.validateAllLedgers().allBalanced).toBe(true);
    expect(escrowService.getEscrow(escrow.id).status).toBe('RELEASED');
  });

  test('condition agreement can omit milestones and blocks release until all conditions and funding are satisfied', () => {
    const escrow = escrowService.createEscrow({ title: 'Purchase', agreementType: 'equipment sale', participants: [{ userId: 'user-1', role: 'PAYER' }, { userId: 'user-2', role: 'PAYEE' }], totalAmount: 100, releaseModel: 'CONDITION_BASED', conditions: [{ type: 'WORK_SUBMITTED' }, { type: 'CLIENT_APPROVAL' }, { type: 'ALL_CONDITIONS_MET' }] });
    expect(milestoneService.getMilestonesByEscrow(escrow.id)).toHaveLength(0);
    expect(() => escrowService.releaseConditionEscrow(escrow.id, 'user-1')).toThrow('Unmet conditions');
    escrowService.fundEscrow(escrow.id, null, 'user-1');
    expect(() => escrowService.satisfyCondition(escrow.id, 'WORK_SUBMITTED', 'user-1')).toThrow('role PAYEE');
    const workCondition = conditionRepository.getConditionsByEscrowId(escrow.id).find(condition => condition.type === 'WORK_SUBMITTED');
    expect(() => escrowService.satisfyConditionById(workCondition.id, 'user-2')).toThrow('Evidence or verification details are required');
    const submitted = escrowService.satisfyConditionById(workCondition.id, 'user-2', 'https://files.example/work.zip');
    expect(submitted.condition.status).toBe('SUBMITTED');
    expect(escrowService.getReleaseEligibility(escrow.id).eligible).toBe(false);
    const reviewed = escrowService.reviewWorkCondition(workCondition.id, 'user-1', 'APPROVE');
    expect(reviewed.condition.status).toBe('SATISFIED');
    escrowService.satisfyCondition(escrow.id, 'CLIENT_APPROVAL', 'user-1');
    expect(escrowService.getReleaseEligibility(escrow.id).eligible).toBe(true);
    escrowService.releaseConditionEscrow(escrow.id, 'user-1');
    expect(() => escrowService.releaseConditionEscrow(escrow.id, 'user-1')).toThrow();
    expect(transactionService.getTransactionsByEscrow(escrow.id).filter(t => t.type === 'RELEASE')).toHaveLength(1);
    expect(accountRepository.getAccountByUserId('user-2').balance).toBe(100);
    expect(accountRepository.getEscrowAccount().balance).toBe(0);
    expect(ledgerService.validateAllLedgers().allBalanced).toBe(true);
    expect(conditionRepository.getConditionsByEscrowId(escrow.id)).toHaveLength(2);
    expect(escrowRepository.getEscrowById(escrow.id)).not.toHaveProperty('conditions');
  });

  test('only provider submits work and client approves or requests revisions with feedback', () => {
    const escrow = escrowService.createEscrow({
      clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100, releaseModel: 'CONDITION_BASED',
      conditions: [{ type: 'WORK_SUBMITTED', config: { actorRole: 'PAYER' } }],
    });
    escrowService.fundEscrow(escrow.id, null, 'user-1');
    const work = conditionRepository.getConditionsByEscrowId(escrow.id)[0];
    expect(() => escrowService.satisfyConditionById(work.id, 'user-1', 'submission')).toThrow('role PAYEE');
    expect(() => escrowService.reviewWorkCondition(work.id, 'user-1', 'APPROVE')).toThrow('must be submitted');
    escrowService.satisfyConditionById(work.id, 'user-2', 'first submission');
    expect(() => escrowService.reviewWorkCondition(work.id, 'user-2', 'APPROVE')).toThrow('Only the agreement creator');
    expect(() => escrowService.reviewWorkCondition(work.id, 'user-1', 'REJECT')).toThrow('Provide feedback');
    const rejected = escrowService.reviewWorkCondition(work.id, 'user-1', 'REJECT', 'Please include the signed report.');
    expect(rejected.condition.status).toBe('REJECTED');
    expect(rejected.condition.verificationDetails.reviewFeedback).toBe('Please include the signed report.');
    expect(() => escrowService.releaseConditionEscrow(escrow.id, 'user-1')).toThrow('Unmet conditions');
    const resubmitted = escrowService.satisfyConditionById(work.id, 'user-2', 'revised submission');
    expect(resubmitted.condition.status).toBe('SUBMITTED');
    expect(resubmitted.condition.verificationDetails.evidence).toBe('revised submission');
    expect(escrowService.reviewWorkCondition(work.id, 'user-1', 'APPROVE').condition.status).toBe('SATISFIED');
  });

  test('evidence-submitted conditions require provider evidence and creator review', () => {
    const escrow = escrowService.createEscrow({
      clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100, releaseModel: 'CONDITION_BASED',
      conditions: [{ type: 'EVIDENCE_SUBMITTED', config: { evidenceRequirement: 'Signed title report', actorRole: 'PAYER' } }],
    });
    escrowService.fundEscrow(escrow.id, null, 'user-1');
    const evidenceCondition = conditionRepository.getConditionsByEscrowId(escrow.id)[0];
    expect(evidenceCondition.config.actorRole).toBe('PAYEE');
    expect(() => escrowService.satisfyConditionById(evidenceCondition.id, 'user-1', 'report.pdf')).toThrow('role PAYEE');
    expect(() => escrowService.satisfyConditionById(evidenceCondition.id, 'user-2')).toThrow('Evidence or verification details are required');
    expect(escrowService.satisfyConditionById(evidenceCondition.id, 'user-2', 'report.pdf').condition.status).toBe('SUBMITTED');
    expect(escrowService.reviewWorkCondition(evidenceCondition.id, 'user-1', 'APPROVE').condition.status).toBe('SATISFIED');
  });

  test('conditions can be added, edited and removed before funding; optional conditions do not block ALL_REQUIRED', () => {
    const escrow = escrowService.createEscrow({ clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100, releaseModel: 'CONDITION_BASED', conditions: [{ title: 'Required delivery', description: 'Delivery must be confirmed.', type: 'DELIVERY_CONFIRMED', required: false }] });
    const original = conditionRepository.getConditionsByEscrowId(escrow.id)[0];
    const added = escrowService.createCondition(escrow.id, { title: 'Inspection', description: 'Inspection must be recorded.', type: 'CUSTOM', required: true, config: { actorRole: 'PAYER' } }, 'user-1');
    expect(added.id).toBeTruthy();
    const updated = escrowService.updateCondition(added.id, { title: 'Final inspection', description: 'Final inspection must be recorded.' }, 'user-1');
    expect(updated.title).toBe('Final inspection');
    escrowService.deleteCondition(original.id, 'user-1');
    expect(conditionRepository.getConditionsByEscrowId(escrow.id)).toHaveLength(1);
    escrowService.fundEscrow(escrow.id, null, 'user-1');
    expect(escrowService.getReleaseEligibility(escrow.id).eligible).toBe(false);
    expect(() => escrowService.updateCondition(added.id, { title: 'Changed after funding' }, 'user-1')).toThrow('cannot be changed after funding');
    expect(() => escrowService.createCondition(escrow.id, { title: 'Late', description: 'Too late.', type: 'CUSTOM', config: { actorRole: 'PAYER' } }, 'user-1')).toThrow('cannot be changed after funding');
    expect(() => escrowService.deleteCondition(added.id, 'user-1')).toThrow('cannot be changed after funding');

    const optionalEscrow = escrowService.createEscrow({ clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100, releaseModel: 'CONDITION_BASED', conditions: [{ title: 'Optional inspection', description: 'Inspection may be added later.', type: 'CUSTOM', required: false, config: { actorRole: 'PAYER' } }] });
    escrowService.fundEscrow(optionalEscrow.id, null, 'user-1');
    expect(escrowService.getReleaseEligibility(optionalEscrow.id).eligible).toBe(true);
  });

  test('deadline condition becomes eligible at the configured time but does not auto-release', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const escrow = escrowService.createEscrow({ title: 'Timed', clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100, releaseModel: 'CONDITION_BASED', conditions: [{ type: 'DEADLINE_REACHED', deadline: '2026-01-02T00:00:00.000Z' }] });
    escrowService.fundEscrow(escrow.id, null, 'user-1');
    expect(escrowService.getReleaseEligibility(escrow.id).eligible).toBe(false);
    jest.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
    expect(escrowService.getReleaseEligibility(escrow.id).eligible).toBe(true);
    expect(transactionService.getTransactionsByEscrow(escrow.id).filter(t => t.type === 'RELEASE')).toHaveLength(0);
    escrowService.releaseConditionEscrow(escrow.id, 'user-1');
    expect(accountRepository.getAccountByUserId('user-2').balance).toBe(100);
    jest.useRealTimers();
  });

  test('rejects unsupported conditions, unauthorized release and insufficient funding', () => {
    expect(() => escrowService.createEscrow({ clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100, releaseModel: 'CONDITION_BASED', conditions: [{ type: 'MAGIC' }] })).toThrow(ValidationError);
    const escrow = escrowService.createEscrow({ clientId: 'user-1', freelancerId: 'user-2', totalAmount: 1000001, releaseModel: 'CONDITION_BASED', conditions: [{ type: 'DEADLINE_REACHED', deadline: '2020-01-01T00:00:00Z' }] });
    expect(() => escrowService.releaseConditionEscrow(escrow.id, 'user-2')).toThrow('Only the agreement client');
    expect(() => escrowService.fundEscrow(escrow.id, null, 'user-1')).toThrow('Insufficient balance');
  });

  test('disputed escrows cannot release, and invalid or unauthorized milestone transitions are rejected', () => {
    const conditionEscrow = escrowService.createEscrow({ clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100, releaseModel: 'CONDITION_BASED', conditions: [{ type: 'DEADLINE_REACHED', deadline: '2020-01-01T00:00:00Z' }] });
    escrowService.fundEscrow(conditionEscrow.id, null, 'user-1');
    escrowRepository.updateEscrow(conditionEscrow.id, { disputed: true, status: 'DISPUTED' });
    expect(() => escrowService.releaseConditionEscrow(conditionEscrow.id, 'user-1')).toThrow('disputed, blocked, cancelled, or expired');

    const milestoneEscrow = escrowService.createEscrow({ clientId: 'user-1', freelancerId: 'user-2', totalAmount: 100, milestones: [{ title: 'Delivery', description: 'Deliver completed work', amount: 100 }] });
    const milestone = milestoneService.getMilestonesByEscrow(milestoneEscrow.id)[0];
    expect(() => milestoneService.updateMilestoneStatus(milestone.id, 'START', 'user-2')).toThrow('Cannot perform');
    expect(() => milestoneService.updateMilestoneStatus(milestone.id, 'START', 'user-1')).toThrow('not authorized');
  });

  test('legacy resolver path cannot unfreeze a dispute without financial allocation', () => {
    getStore().users.push({ id: 'user-3', name: 'Resolver', type: 'RESOLVER', createdAt: Date.now() });
    const escrow = escrowService.createEscrow({ title: 'Resolved purchase', participants: [
      { userId: 'user-1', role: 'PAYER' }, { userId: 'user-2', role: 'PAYEE' }, { userId: 'user-3', role: 'RESOLVER' },
    ], totalAmount: 100, releaseModel: 'CONDITION_BASED', conditions: [{ type: 'DEADLINE_REACHED', deadline: '2020-01-01T00:00:00Z' }] });
    escrowService.fundEscrow(escrow.id, null, 'user-1');
    escrowService.raiseDispute(escrow.id, 'user-1', 'Delivery needs review');
    expect(() => escrowService.releaseConditionEscrow(escrow.id, 'user-1')).toThrow('disputed, blocked, cancelled, or expired');
    expect(() => escrowService.resolveDispute(escrow.id, 'user-2', 'resolved')).toThrow('Admin dispute resolution workflow');
    expect(() => escrowService.resolveDispute(escrow.id, 'user-3', 'Delivery confirmed')).toThrow('Admin dispute resolution workflow');
    expect(escrowService.getReleaseEligibility(escrow.id).eligible).toBe(false);
    expect(() => escrowService.releaseConditionEscrow(escrow.id, 'user-1')).toThrow('disputed, blocked, cancelled, or expired');
    expect(accountRepository.getAccountByUserId('user-2').balance).toBe(0);
  });
});
