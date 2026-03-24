import { authenticate, handleCors } from './_shared/auth.js';
import { withErrorHandler } from './_shared/ops-db.js';
import { normalizeLiveIngestDocuments } from './_shared/live-ingest-normalize.js';

export default withErrorHandler(async function handler(req, res) {
  if (handleCors(req, res)) return;

  const user = await authenticate(req, res);
  if (!user) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const action = req.query?.action || req.body?.action || 'normalize';
  if (action !== 'normalize') {
    return res.status(400).json({ error: 'Unsupported action. Use action=normalize.' });
  }

  const docs = Array.isArray(req.body?.documents) ? req.body.documents : [];
  const normalized = normalizeLiveIngestDocuments(docs);

  return res.status(200).json({
    ok: true,
    documents: normalized,
    count: normalized.length
  });
});
