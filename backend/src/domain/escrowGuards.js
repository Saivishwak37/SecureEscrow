const { ValidationError } = require('../utils/errors');

function assertEscrowNotDisputed(escrow, operation) {
  if (escrow.disputed || escrow.status === 'DISPUTED') {
    throw new ValidationError(`${operation} is blocked because the escrow is disputed, blocked, cancelled, or expired`);
  }
}

module.exports = { assertEscrowNotDisputed };
