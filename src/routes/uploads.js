import { Router } from 'express';
import multer from 'multer';
import { HttpError, ah } from '../middleware/errors.js';
import { cloudinaryReady, deleteImage, uploadImage } from '../lib/cloudinary.js';

const router = Router();

// Any file type is accepted (images of every format, logos, SVG, PDF reports); Cloudinary detects the type.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

/**
 * POST /api/admin/uploads?kind=gallery  (multipart field "image" or "file")
 * `kind` is just the Cloudinary sub-folder (gallery, logos, banners, events, avatars, reports…).
 * Returns { url, publicId }. Store `url` in a record's photo/logo/url field.
 */
router.post(
  '/',
  // Read the file before refusing: answering mid-upload makes the browser report a connection reset
  // instead of this message.
  upload.any(),
  (req, res, next) => (cloudinaryReady ? next() : next(new HttpError(503, 'Uploads disabled: set the Cloudinary API key in backend/.env'))),
  ah(async (req, res) => {
    const file = req.files?.[0];
    if (!file) throw new HttpError(400, 'No file received');
    const kind = String(req.query.kind || 'uploads').replace(/[^a-z0-9_-]/gi, '') || 'uploads';
    try {
      res.status(201).json(await uploadImage(file.buffer, kind));
    } catch (err) {
      // Turn Cloudinary account problems into something the admin can act on.
      if (err?.http_code === 403) throw new HttpError(502, 'Cloudinary refused the upload: this API key has no upload (create) permission. Use the Root API key or allow uploads for this key in Cloudinary.');
      if (err?.http_code === 401) throw new HttpError(502, 'Cloudinary rejected the API key or secret in backend/.env');
      if (err?.http_code === 400) throw new HttpError(400, `Cloudinary could not process this file: ${err.message}`);
      throw err;
    }
  }),
);

router.delete(
  '/:publicId(*)',
  ah(async (req, res) => {
    if (!cloudinaryReady) throw new HttpError(503, 'Uploads disabled');
    if (!req.params.publicId.startsWith('ssvj/')) throw new HttpError(400, 'Only ssvj/ files can be deleted');
    await deleteImage(req.params.publicId);
    res.status(204).end();
  }),
);

export default router;
