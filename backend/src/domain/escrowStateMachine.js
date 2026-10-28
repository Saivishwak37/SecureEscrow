// Escrow State Machine Domain Logic
// Defines the valid states, actions, and transitions for the escrow lifecycle

const { InvalidStateTransitionError } = require('../utils/errors');

// All valid escrow statuses
const STATES = {
  CREATED: 'CREATED',           // Escrow created, waiting for funds
  FUNDED: 'FUNDED',             // Escrow funded by client, ready to start
  IN_PROGRESS: 'IN_PROGRESS',   // Work is actively being done
  SUBMITTED: 'SUBMITTED',       // Work submitted for review
  UNDER_REVIEW: 'UNDER_REVIEW', // Client is reviewing the work
  APPROVED: 'APPROVED',         // Work approved, waiting for release
  RELEASED: 'RELEASED',         // Funds released to freelancer, milestone complete
  CANCELLED: 'CANCELLED',       // Escrow cancelled, funds refunded if any
  DISPUTED: 'DISPUTED',         // Escrow in dispute
  RESOLVED: 'RESOLVED',         // Dispute resolved
  EXPIRED: 'EXPIRED'            // Escrow expired before funding or starting
};

// All valid actions that can trigger a state transition
const ACTIONS = {
  FUND: 'FUND',           // Client adds funds
  START: 'START',         // Freelancer starts work
  SUBMIT: 'SUBMIT',       // Freelancer submits work
  REVIEW: 'REVIEW',       // Client begins reviewing
  APPROVE: 'APPROVE',     // Client approves work
  RELEASE: 'RELEASE',     // System releases funds automatically after approval
  CANCEL: 'CANCEL',       // Client or System cancels
  DISPUTE: 'DISPUTE',     // Client or Freelancer raises dispute
  RESOLVE: 'RESOLVE'      // Admin resolves dispute
};

// Transition matrix expressing the strict state machine rules
// Key = Current State, Value = Object mapping Actions to New States
const TRANSITION_RULES = {
  [STATES.CREATED]: {
    [ACTIONS.FUND]: STATES.FUNDED,
    [ACTIONS.CANCEL]: STATES.CANCELLED
  },
  [STATES.FUNDED]: {
    [ACTIONS.START]: STATES.IN_PROGRESS,
    [ACTIONS.CANCEL]: STATES.CANCELLED
    // EXPIRY can be introduced later as a separate action/time-based rule
  },
  [STATES.IN_PROGRESS]: {
    [ACTIONS.SUBMIT]: STATES.SUBMITTED,
    [ACTIONS.DISPUTE]: STATES.DISPUTED
  },
  [STATES.SUBMITTED]: {
    [ACTIONS.REVIEW]: STATES.UNDER_REVIEW,
    [ACTIONS.DISPUTE]: STATES.DISPUTED
  },
  [STATES.UNDER_REVIEW]: {
    [ACTIONS.APPROVE]: STATES.APPROVED,
    [ACTIONS.DISPUTE]: STATES.DISPUTED // Rejection is handled as dispute or specific action if needed
  },
  [STATES.APPROVED]: {
    [ACTIONS.RELEASE]: STATES.RELEASED
  },
  [STATES.DISPUTED]: {
    [ACTIONS.RESOLVE]: STATES.RESOLVED,
    [ACTIONS.CANCEL]: STATES.CANCELLED   // Resolve in favor of client refund
  },
  [STATES.RELEASED]: {},  // Terminal states allow no further transitions
  [STATES.CANCELLED]: {},
  [STATES.RESOLVED]: {},
  [STATES.EXPIRED]: {}
};

/**
 * Validates and executes a state transition based on the state machine rules
 * @param {string} currentState The current state of the escrow/milestone
 * @param {string} action The action being attempted
 * @returns {string} The new state if valid
 * @throws {InvalidStateTransitionError} If the transition is not allowed
 */
function transition(currentState, action) {
  // Validate current state is a known state
  if (!TRANSITION_RULES[currentState]) {
    throw new InvalidStateTransitionError(currentState, action, null);
  }

  const allowedTransitions = TRANSITION_RULES[currentState];
  const newState = allowedTransitions[action];

  if (!newState) {
    // Collect allowed actions for a helpful error message
    const allowedActions = Object.keys(allowedTransitions);
    throw new InvalidStateTransitionError(currentState, action, allowedActions);
  }

  return newState;
}

/**
 * Returns all valid actions from a given state (useful for UI rendering)
 * @param {string} state Current state
 * @returns {Array<string>} List of valid actions
 */
function getValidActions(state) {
  return TRANSITION_RULES[state] ? Object.keys(TRANSITION_RULES[state]) : [];
}

module.exports = {
  STATES,
  ACTIONS,
  transition,
  getValidActions,
  TRANSITION_RULES
};
