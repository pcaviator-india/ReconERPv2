const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

// Configure multer for memory storage (files go directly to R2)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

/**
 * POST /api/v1/files/upload
 * Upload file to R2 storage
 * Accepts multipart/form-data with 'file' field and optional 'category' field
 */
router.post('/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No file provided' });
    }

    const db = req.app.locals.db;
    const r2 = req.app.locals.r2;
    const fileId = uuidv4();
    const category = req.body.category || 'general';
    const originalName = req.file.originalname;
    const contentType = req.file.mimetype;
    const size = req.file.size;

    // Build R2 key: category/fileId/filename
    const r2Key = `${category}/${fileId}/${originalName}`;

    // Upload file buffer to R2
    if (r2) {
      await r2.put(r2Key, req.file.buffer, {
        httpMetadata: {
          contentType: contentType,
          contentDisposition: `attachment; filename="${originalName}"`,
        },
      });
    }

    // Store file metadata in D1
    const stmt = await db.prepare(`
      INSERT INTO files (id, original_name, r2_key, content_type, size, category, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    await stmt.bind(fileId, originalName, r2Key, contentType, size, category, req.user.userId).run();

    res.status(201).json({
      status: 'success',
      data: {
        id: fileId,
        original_name: originalName,
        r2_key: r2Key,
        content_type: contentType,
        size: size,
        category: category
      },
      message: 'File uploaded successfully'
    });
  } catch (err) {
    console.error('Upload file error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/files/:fileId
 * Get file metadata from D1
 */
router.get('/:fileId', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare('SELECT * FROM files WHERE id = ?');
    const file = await stmt.bind(req.params.fileId).first();

    if (!file) {
      return res.status(404).json({ status: 'error', message: 'File not found' });
    }

    res.json({
      status: 'success',
      data: {
        id: file.id,
        original_name: file.original_name,
        content_type: file.content_type,
        size: file.size,
        download_url: `/api/v1/files/${file.id}/download`
      }
    });
  } catch (err) {
    console.error('Get file info error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/files/:fileId/download
 * Stream file content from R2
 */
router.get('/:fileId/download', authenticateToken, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const r2 = req.app.locals.r2;
    const stmt = await db.prepare('SELECT * FROM files WHERE id = ?');
    const file = await stmt.bind(req.params.fileId).first();

    if (!file) {
      return res.status(404).json({ status: 'error', message: 'File not found' });
    }

    // In Cloudflare Workers, use R2 binding to get the object and stream it
    if (r2) {
      const object = await r2.get(file.r2_key);

      if (!object) {
        return res.status(404).json({ status: 'error', message: 'File not found in storage' });
      }

      res.setHeader('Content-Type', file.content_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
      res.setHeader('Content-Length', object.size);

      // Stream the R2 object body to the response
      const reader = object.body.getReader();
      const stream = new ReadableStream({
        start(controller) {
          function pump() {
            reader.read().then(({ done, value }) => {
              if (done) {
                controller.close();
                return;
              }
              controller.enqueue(value);
              pump();
            }).catch(err => {
              controller.error(err);
            });
          }
          pump();
        }
      });

      return res.send(stream);
    }

    res.status(501).json({
      status: 'error',
      message: 'File download requires Cloudflare R2 binding (not available in local dev)'
    });
  } catch (err) {
    console.error('Download file error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;
