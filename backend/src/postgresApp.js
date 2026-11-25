const express = require('express');
const postgresUsers = require('./repositories/postgresUsers');
const { postgresCore } = require('./repositories/postgresCore');
const { postgresLedger } = require('./services/postgresLedger');
const postgresWorkflow = require('./services/postgresWorkflow');
const { postgresDisputes } = require('./services/postgresDisputes');
const postgresEvidence = require('./services/postgresEvidence');
const { uploadDisputeEvidence } = require('./middleware/disputeEvidenceUpload');
const { rememberAmountSource } = require('./domain/postgresMoney');
const createAuthService = require('./services/createAuthService');
const createAuthenticate = require('./middleware/createAuthenticate');
const requireRole = require('./middleware/requireRole');
const rejectIdentitySpoof = require('./middleware/rejectIdentitySpoof');
const { BaseError, UnauthorizedError, ValidationError } = require('./utils/errors');

function financialInput(req, allowed = []) {
  const body = req.body ?? {};
  if (typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
    throw new ValidationError('Unexpected financial request fields');
  }
  return body;
}

function respond(action, status = 200) {
  return async (req, res, next) => {
    try {
      res.status(status).json({ success: true, data: await action(req) });
    } catch (error) {
      next(error);
    }
  };
}

function createPostgresApp(db) {
  const app = express();
  const api = express.Router();
  const users = postgresUsers(db);
  const core = postgresCore(db);
  const ledger = postgresLedger(db, core);
  const workflow = postgresWorkflow(db);
  const disputes = postgresDisputes(db);
  const evidence = postgresEvidence(db, disputes);
  const auth = createAuthService(users, users.provisionUser);
  const authenticate = createAuthenticate(users);
  const clientOnly = requireRole('CLIENT');
  const participants = requireRole('CLIENT', 'PROVIDER');
  const adminOnly = requireRole('ADMIN');

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
  app.use(express.json({ limit: '50mb', reviver: rememberAmountSource }));
  app.get('/health', (req, res) => res.json({
    status: 'ok', timestamp: Date.now(), service: 'SecureEscrow-Backend', persistence: 'postgresql',
  }));

  api.post('/auth/register', respond(req => auth.register(req.body), 201));
  api.post('/auth/login', respond(req => auth.login(req.body)));
  api.get('/auth/me', authenticate, respond(req => req.auth.user));
  api.use(authenticate, rejectIdentitySpoof);

  api.post('/users', adminOnly, respond(req => users.createLegacyProfile(req.body ?? {}), 201));
  api.get('/users', respond(async ({ auth: actor }) => {
    if (actor.role === 'ADMIN') return users.list({});
    if (actor.role === 'CLIENT') return users.list({ role: 'PROVIDER', isActive: true, passwordHash: { not: null } });
    const escrows = await core.listEscrows(actor);
    return users.list({ id: { in: [actor.userId, ...escrows.map(escrow => escrow.clientId)] } });
  }));
  api.get('/users/:id', respond(async ({ auth: actor, params: { id } }) => {
    const user = await users.getUserById(id);
    if (actor.role === 'ADMIN' || id === actor.userId) return user;
    if (actor.role === 'CLIENT' && user.role === 'PROVIDER' && user.isActive) return user;
    if (actor.role === 'PROVIDER' && (await core.listEscrows(actor)).some(escrow => escrow.clientId === id)) return user;
    throw new UnauthorizedError();
  }));

  api.post('/accounts', requireRole('CLIENT', 'PROVIDER'), respond(req => core.createAccount(req.auth, req.body), 201));
  api.get('/accounts/user/:userId', respond(req => {
    if (req.auth.role !== 'ADMIN' && req.auth.userId !== req.params.userId) throw new UnauthorizedError();
    return core.accountDetails({ userId: req.params.userId, type: 'PERSONAL', currency: 'INR' }, req.auth);
  }));
  api.get('/accounts/escrow-held', participants, respond(req => ledger.participantHoldings(req.auth)));
  api.get('/accounts/:accountId', respond(req => core.accountDetails({ id: req.params.accountId }, req.auth)));

  api.post('/escrows', clientOnly, respond(req => core.createEscrow(req.auth, req.body), 201));
  api.get('/escrows', respond(req => core.listEscrows(req.auth)));
  api.get('/escrows/:id', respond(req => core.getEscrow(req.params.id, req.auth)));
  api.get('/escrows/:id/actions', respond(req => workflow.escrowActions(req.params.id, req.auth)));
  api.get('/escrows/:id/milestones', respond(req => core.listMilestones(req.params.id, req.auth)));
  api.post('/escrows/:id/milestones', clientOnly, respond(req => core.addMilestone(req.params.id, req.auth, req.body), 201));
  api.get('/milestones/:id', respond(req => core.getMilestone(req.params.id, req.auth)));
  api.get('/milestones/:id/actions', respond(req => workflow.milestoneActions(req.params.id, req.auth)));
  api.get('/escrows/:id/conditions', respond(req => workflow.listConditions(req.params.id, req.auth)));
  api.post('/escrows/:id/conditions', clientOnly, respond(req => core.addCondition(req.params.id, req.auth, req.body), 201));
  api.patch('/conditions/:id', clientOnly, respond(req => core.changeCondition(req.params.id, req.auth, req.body)));
  api.delete('/conditions/:id', clientOnly, respond(req => core.changeCondition(req.params.id, req.auth, null, true)));

  for (const [path, type] of [['deposit', 'DEPOSIT'], ['withdraw', 'WITHDRAWAL']]) {
    api.post(`/accounts/:id/${path}`, requireRole('CLIENT', 'PROVIDER'), respond(req =>
      ledger.walletTransfer(req.auth, req.params.id, type, financialInput(req, ['amount']), req.get('Idempotency-Key')), 201));
  }
  api.get('/accounts/:id/ledger', respond(req => ledger.accountHistory(req.params.id, req.auth, true)));
  api.get('/accounts/:id/transactions', respond(req => ledger.accountHistory(req.params.id, req.auth, false)));
  api.post('/escrows/:id/fund', clientOnly, respond(req => workflow.fund(req.params.id, req.auth, financialInput(req, ['milestoneId']).milestoneId)));
  api.post('/escrows/:id/start', requireRole('PROVIDER'), respond(req => workflow.milestoneAction(req.body?.milestoneId, req.auth, 'START', req.body, req.params.id)));
  api.post('/escrows/:id/release', clientOnly, respond(req => {
    financialInput(req);
    return workflow.release(req.params.id, req.auth);
  }));
  api.get('/escrows/:id/release-eligibility', respond(req => workflow.eligibility(req.params.id, req.auth)));
  api.get('/escrows/:id/ledger', respond(req => ledger.escrowHistory(req.params.id, req.auth, true)));
  api.get('/escrows/:id/transactions', respond(req => ledger.escrowHistory(req.params.id, req.auth, false)));
  for (const action of ['SUBMIT', 'REVIEW', 'APPROVE', 'REJECT']) {
    api.post(`/milestones/:id/${action.toLowerCase()}`, requireRole(action === 'SUBMIT' ? 'PROVIDER' : 'CLIENT'),
      respond(req => workflow.milestoneAction(req.params.id, req.auth, action, req.body)));
  }
  api.post('/milestones/:id/release', clientOnly, respond(req => {
    financialInput(req);
    return workflow.release(null, req.auth, req.params.id);
  }));
  api.post('/conditions/:id/satisfy', respond(req => workflow.conditionAction(req.auth, { id: req.params.id, evidence: req.body?.evidence })));
  api.post('/conditions/:id/review', clientOnly, respond(req => workflow.conditionAction(req.auth, {
    id: req.params.id, review: true, decision: req.body?.decision, feedback: req.body?.feedback,
  })));
  api.post('/escrows/:id/conditions/:type/satisfy', respond(req => workflow.conditionAction(req.auth, {
    escrowId: req.params.id, type: req.params.type, evidence: req.body?.evidence,
  })));
  api.get('/transactions/validation/ledger', requireRole('ADMIN'), respond(() => ledger.validateLedger()));
  api.get('/transactions/escrow/:id', respond(req => ledger.escrowHistory(req.params.id, req.auth, false)));
  api.get('/transactions/:id/ledger', respond(req => ledger.transactionDetails(req.params.id, req.auth, true)));
  api.get('/transactions/:id', respond(req => ledger.transactionDetails(req.params.id, req.auth, false)));
  api.post('/escrows/:id/disputes', participants, respond(req => disputes.create(req.params.id, req.auth, req.body), 201));
  api.get('/escrows/:id/disputes', respond(req => disputes.list(req.params.id, req.auth, req.query.status)));
  api.get('/disputes/:id', respond(req => disputes.lookup(req.params.id, req.auth)));
  api.post('/disputes/:id/resolve', adminOnly, respond(req => disputes.resolve(req.params.id, req.auth, req.body), 201));
  api.patch('/disputes/:id/status', adminOnly, respond(req => disputes.changeStatus(req.params.id, req.auth, req.body?.status, req.body?.reason)));
  api.get('/disputes/:id/history', respond(req => disputes.history(req.params.id, req.auth)));
  api.get('/disputes/:id/resolutions', respond(req => disputes.resolutions(req.params.id, req.auth)));
  api.get('/disputes/:id/messages', respond(req => disputes.messages(req.params.id, req.auth)));
  api.post('/disputes/:id/messages', participants, respond(req => disputes.sendMessage(req.params.id, req.auth, req.body?.message), 201));
  api.post('/disputes/:id/evidence', participants, async (req, res, next) => {
    try { await disputes.checkUpload(req.params.id, req.auth); next(); }
    catch (error) { next(error); }
  }, uploadDisputeEvidence, rejectIdentitySpoof, respond(req => evidence.upload(req.params.id, req.auth, req.file, req.body?.description), 201));
  api.get('/disputes/:id/evidence', respond(req => evidence.list(req.params.id, req.auth)));
  api.get('/disputes/:id/evidence/:evidenceId/file', async (req, res, next) => {
    try { await evidence.download(req.params.id, req.params.evidenceId, req.auth, res); }
    catch (error) { next(error); }
  });

  app.use('/api', api);
  app.use((req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Route not found' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof BaseError) return res.status(error.statusCode).json(error.toJSON());
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'The request is too large' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Malformed JSON' });
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' });
  });
  return app;
}

module.exports = createPostgresApp;
