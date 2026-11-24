const path = require('path');
const evidenceService = require('../services/disputeEvidenceService');
const resourceAuthorization = require('../services/resourceAuthorization');

function withDownloadUrl(disputeId, evidence) {
  return { ...evidence, downloadUrl: `/api/disputes/${encodeURIComponent(disputeId)}/evidence/${encodeURIComponent(evidence.id)}/file` };
}

async function upload(req, res, next) {
  try {
    resourceAuthorization.assertDisputeAccess(req.params.disputeId, req.auth, { allowAdmin: false });
    const evidence = await evidenceService.uploadEvidence(req.params.disputeId, req.auth.userId, req.file, req.body?.description);
    res.status(201).json({ success: true, data: withDownloadUrl(req.params.disputeId, evidence) });
  } catch (error) { next(error); }
}

function list(req, res, next) {
  try {
    resourceAuthorization.assertDisputeAccess(req.params.disputeId, req.auth);
    const evidence = evidenceService.listEvidence(req.params.disputeId, req.auth.userId);
    res.json({ success: true, data: evidence.map(item => withDownloadUrl(req.params.disputeId, item)) });
  } catch (error) { next(error); }
}

function download(req, res, next) {
  try {
    resourceAuthorization.assertDisputeAccess(req.params.disputeId, req.auth);
    const { evidence, filePath } = evidenceService.getEvidenceFile(req.params.disputeId, req.params.evidenceId, req.auth.userId);
    const asciiName = evidence.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const encodedName = encodeURIComponent(evidence.fileName).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    res.set({
      'Content-Type': evidence.mimeType,
      'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(evidence.fileSize),
    });
    res.sendFile(path.resolve(filePath), error => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) { next(error); }
}

module.exports = { upload, list, download };
