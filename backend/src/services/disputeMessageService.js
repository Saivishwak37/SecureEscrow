const { getStore } = require('../data/store');
const escrowRepository = require('../repositories/escrowRepository');
const disputeRepository = require('../repositories/disputeRepository');
const messageRepository = require('../repositories/disputeMessageRepository');
const { ValidationError, UnauthorizedError } = require('../utils/errors');

const MAX_MESSAGE_LENGTH = Number.parseInt(process.env.DISPUTE_MESSAGE_MAX_LENGTH || '5000', 10);

function participantIds(escrow) {
  return escrow.participants?.length
    ? escrow.participants.filter(item => ['PAYER', 'PAYEE', 'CLIENT', 'PROVIDER'].includes(item.role)).map(item => item.userId)
    : [escrow.payerId || escrow.clientId, escrow.payeeId || escrow.freelancerId];
}

function authorize(disputeId, actorId) {
  if (typeof actorId !== 'string' || !actorId) throw new UnauthorizedError('A participant identity is required');
  const dispute = disputeRepository.getDisputeById(disputeId);
  const escrow = escrowRepository.getEscrowById(dispute.escrowId);
  const user = getStore().findById('users', actorId);
  const role = user?.role || user?.type;
  const isParticipant = user?.isActive !== false && participantIds(escrow).includes(actorId)
    && ((role === 'CLIENT' && actorId === (escrow.clientId || escrow.payerId))
      || (role === 'PROVIDER' && actorId === (escrow.freelancerId || escrow.payeeId)));
  const isAdmin = user?.isActive !== false && role === 'ADMIN';
  if (!isParticipant && !isAdmin) throw new UnauthorizedError('Only an escrow participant or authorized admin may access dispute messages');
  return { dispute, escrow, user, isAdmin, isParticipant };
}

function publicMessage(message) {
  const sender = getStore().findById('users', message.senderId);
  return { ...message, sender: sender ? { id: sender.id, name: sender.name || sender.username, type: sender.role || sender.type } : null };
}

function sendMessage(disputeId, actorId, message) {
  const { dispute, isParticipant, isAdmin } = authorize(disputeId, actorId);
  if (!isParticipant) throw new UnauthorizedError('Only dispute participants may send messages');
  if (dispute.status === 'RESOLVED') throw new ValidationError('Messages can only be sent while a dispute is active');
  if (typeof message !== 'string' || !message.trim()) throw new ValidationError('Message cannot be empty');
  if (!Number.isInteger(MAX_MESSAGE_LENGTH) || MAX_MESSAGE_LENGTH < 1) throw new Error('DISPUTE_MESSAGE_MAX_LENGTH must be a positive integer');
  if (message.length > MAX_MESSAGE_LENGTH) throw new ValidationError(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
  return publicMessage(messageRepository.createMessage({ disputeId, senderId: actorId, message }));
}

function listMessages(disputeId, actorId) {
  authorize(disputeId, actorId);
  return messageRepository.getMessagesByDisputeId(disputeId).map(publicMessage);
}

module.exports = { sendMessage, listMessages, MAX_MESSAGE_LENGTH };
