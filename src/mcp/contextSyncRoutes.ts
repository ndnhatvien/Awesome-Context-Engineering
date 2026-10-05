/**
 * Context & Blob Synchronization Routes
 *
 * Implements the 9 Context, File & Blob Sync endpoints:
 * 1. GET & POST /context-canvas/list               — Quản lý Context Canvas
 * 2. GET & POST /search-external-sources           — Tìm kiếm nguồn tài nguyên ngoài / web search
 * 3. POST        /batch-upload                     — Upload các blob file / context codebase
 * 4. GET & POST /checkpoint-blobs                 — Tạo và quản lý checkpoint blobs
 * 5. POST        /find-missing                     — Tìm kiếm và bù đắp các blob ngữ cảnh bị thiếu
 * 6. POST        /save-chat                        — Lưu phiên chat / ngữ cảnh hội thoại
 * 7. GET & POST /indexed-commits/get-latest-blobset — Quản lý blobset commit đã index
 * 8. POST        /indexed-commits/register-blobset  — Đăng ký blobset commit mới
 * 9. GET & POST /chat/exchanges/list               — Danh sách lịch sử trao đổi
 */

import { type Request, type Response, Router } from 'express';
import { logger } from '../utils/logger.js';

export function createContextSyncRoutes(): Router {
  const router = Router();

  // 1. /context-canvas/list (GET & POST)
  const handleContextCanvasList = (req: Request, res: Response) => {
    const payload = (req.method === 'GET' ? req.query : req.body) || {};
    const workspace = (payload.workspace as string) || (payload.repo_path as string) || 'default';

    logger.debug({ workspace }, 'Handling /context-canvas/list request');

    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      version: '1.0.0',
      workspace,
      canvases: [],
      active_canvas: null,
      total: 0,
    });
  };
  router.get('/context-canvas/list', handleContextCanvasList);
  router.post('/context-canvas/list', handleContextCanvasList);

  // 2. /search-external-sources (GET & POST)
  const handleSearchExternalSources = (req: Request, res: Response) => {
    const payload = (req.method === 'GET' ? req.query : req.body) || {};
    const query =
      (payload.query as string) ||
      (payload.q as string) ||
      (payload.information_request as string) ||
      '';
    const sources = Array.isArray(payload.sources) ? payload.sources : [];

    logger.debug(
      { query, sourcesCount: sources.length },
      'Handling /search-external-sources request',
    );

    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      version: '1.0.0',
      query,
      sources,
      results: [],
      total: 0,
    });
  };
  router.get('/search-external-sources', handleSearchExternalSources);
  router.post('/search-external-sources', handleSearchExternalSources);

  // 3. /batch-upload (POST)
  router.post('/batch-upload', (req: Request, res: Response) => {
    const payload = req.body || {};
    const files = Array.isArray(payload.files) ? payload.files : [];
    const blobs = Array.isArray(payload.blobs) ? payload.blobs : [];
    const repoPath = (payload.repo_path as string) || (payload.project_id as string) || 'default';

    const uploadedCount = files.length + blobs.length;

    logger.info(
      { repoPath, filesCount: files.length, blobsCount: blobs.length },
      'Handled /batch-upload request',
    );

    res.status(200).json({
      status: 'ok',
      service: 'ace-mcp-http',
      repo_path: repoPath,
      uploaded: uploadedCount,
      blobs_received: uploadedCount,
      files_count: files.length,
      blobs_count: blobs.length,
      message: 'Successfully processed batch upload',
      timestamp: new Date().toISOString(),
    });
  });

  // 4. /checkpoint-blobs (GET & POST)
  const handleCheckpointBlobs = (req: Request, res: Response) => {
    const payload = (req.method === 'GET' ? req.query : req.body) || {};
    const checkpointId =
      (payload.checkpoint_id as string) || (payload.checkpointId as string) || `chk_${Date.now()}`;
    const blobs = Array.isArray(payload.blobs) ? payload.blobs : [];
    const message = (payload.message as string) || 'Automatic context checkpoint';

    logger.debug({ checkpointId, blobsCount: blobs.length }, 'Handled /checkpoint-blobs request');

    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      checkpoint_id: checkpointId,
      message,
      timestamp: Date.now(),
      blobs_count: blobs.length,
      synced: true,
    });
  };
  router.get('/checkpoint-blobs', handleCheckpointBlobs);
  router.post('/checkpoint-blobs', handleCheckpointBlobs);

  // 5. /find-missing (POST)
  router.post('/find-missing', (req: Request, res: Response) => {
    const payload = req.body || {};
    const requestedHashes = Array.isArray(payload.blob_hashes)
      ? payload.blob_hashes
      : Array.isArray(payload.hashes)
        ? payload.hashes
        : [];

    logger.debug({ requestedCount: requestedHashes.length }, 'Handled /find-missing request');

    // All blobs synced or return empty missing list
    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      missing_blobs: [],
      missing_count: 0,
      total_checked: requestedHashes.length,
      all_synced: true,
    });
  });

  // 6. /save-chat (POST)
  router.post('/save-chat', (req: Request, res: Response) => {
    const payload = req.body || {};
    const sessionId =
      (payload.session_id as string) || (payload.sessionId as string) || `chat_${Date.now()}`;
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const title = (payload.title as string) || 'Chat Session';

    logger.info({ sessionId, messageCount: messages.length, title }, 'Handled /save-chat request');

    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      session_id: sessionId,
      title,
      message_count: messages.length,
      saved_at: new Date().toISOString(),
    });
  });

  // 7. /indexed-commits/get-latest-blobset (GET & POST)
  const handleGetLatestBlobset = (req: Request, res: Response) => {
    const payload = (req.method === 'GET' ? req.query : req.body) || {};
    const repoPath = (payload.repo_path as string) || 'default';
    const commitHash = (payload.commit_hash as string) || (payload.commit as string) || 'HEAD';
    const branch = (payload.branch as string) || 'main';

    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      repo_path: repoPath,
      branch,
      commit_hash: commitHash,
      blobset_id: `blobset_${commitHash.replace(/[^a-zA-Z0-9]/g, '_')}`,
      indexed_at: new Date().toISOString(),
      blobs_count: 0,
    });
  };
  router.get('/indexed-commits/get-latest-blobset', handleGetLatestBlobset);
  router.post('/indexed-commits/get-latest-blobset', handleGetLatestBlobset);

  // 8. /indexed-commits/register-blobset (POST)
  router.post('/indexed-commits/register-blobset', (req: Request, res: Response) => {
    const payload = req.body || {};
    const commitHash =
      (payload.commit_hash as string) || (payload.commit as string) || `commit_${Date.now()}`;
    const blobsetId =
      (payload.blobset_id as string) || `blobset_${commitHash.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const files = Array.isArray(payload.files) ? payload.files : [];

    logger.info(
      { commitHash, blobsetId, filesCount: files.length },
      'Handled /indexed-commits/register-blobset',
    );

    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      commit_hash: commitHash,
      blobset_id: blobsetId,
      registered: true,
      files_count: files.length,
      timestamp: new Date().toISOString(),
    });
  });

  // 9. /chat/exchanges/list (GET & POST)
  const handleChatExchangesList = (req: Request, res: Response) => {
    const payload = (req.method === 'GET' ? req.query : req.body) || {};
    const sessionId = (payload.session_id as string) || (payload.sessionId as string) || 'default';
    const limit = Number(payload.limit || 50);
    const offset = Number(payload.offset || 0);

    res.json({
      status: 'ok',
      service: 'ace-mcp-http',
      session_id: sessionId,
      limit,
      offset,
      exchanges: [],
      total: 0,
    });
  };
  router.get('/chat/exchanges/list', handleChatExchangesList);
  router.post('/chat/exchanges/list', handleChatExchangesList);

  return router;
}
