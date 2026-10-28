// Custom Error Classes for SecureEscrow Domain

class BaseError extends Error {
  constructor(message, statusCode = 500, errorType = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.errorType,
      message: this.message,
      ...(this.details && { details: this.details })
    };
  }
}

class ValidationError extends BaseError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

class NotFoundError extends BaseError {
  constructor(resource, id) {
    super(`${resource} with id ${id} not found`, 404, 'NOT_FOUND', { resource, id });
  }
}

class InvalidStateTransitionError extends BaseError {
  constructor(currentState, action, allowedStates = null) {
    const message = `Cannot perform "${action}" from state "${currentState}"`;
    super(message, 400, 'INVALID_STATE_TRANSITION', { currentState, action, allowedStates });
  }
}

class UnauthorizedError extends BaseError {
  constructor(message = 'Unauthorized') {
    super(message, 403, 'UNAUTHORIZED');
  }
}

class LedgerImbalanceError extends BaseError {
  constructor(debits, credits) {
    super(`Ledger imbalance: Debits (${debits}) !== Credits (${credits})`, 500, 'LEDGER_IMBALANCE', { debits, credits });
  }
}

class DuplicateTransactionError extends BaseError {
  constructor(transactionType, milestoneId) {
    super(`Duplicate ${transactionType} transaction for milestone`, 409, 'DUPLICATE_TRANSACTION', { transactionType, milestoneId });
  }
}

class InsufficientBalanceError extends BaseError {
  constructor(accountId, required, available) {
    super(`Insufficient balance in account ${accountId}. Required: ${required}, Available: ${available}`, 400, 'INSUFFICIENT_BALANCE', { accountId, required, available });
  }
}

module.exports = {
  BaseError,
  ValidationError,
  NotFoundError,
  InvalidStateTransitionError,
  UnauthorizedError,
  LedgerImbalanceError,
  DuplicateTransactionError,
  InsufficientBalanceError
};
