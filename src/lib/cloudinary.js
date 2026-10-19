import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';

const { url, cloudName, apiKey, apiSecret } = env.cloudinary;

// CLOUDINARY_URL is read by the SDK itself; otherwise configure from the separate variables.
if (!url && cloudName) {
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
} else {
  cloudinary.config({ secure: true });
}

const cfg = cloudinary.config();
export const cloudinaryReady = Boolean(cfg.cloud_name && cfg.api_key && cfg.api_secret);

/**
 * Uploads any file into ssvj/<kind>; Cloudinary detects images, SVG, PDF etc. (resource_type auto).
 * PDF and ZIP links only open once "Allow delivery of PDF and ZIP files" is enabled in the Cloudinary
 * console (Settings → Security); new accounts refuse them with 401 "deny or ACL failure".
 */
export function uploadImage(buffer, kind) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: `ssvj/${kind}`, resource_type: 'auto' }, (err, result) =>
      err
        ? reject(err)
        : resolve({
            url: result.secure_url,
            publicId: result.public_id,
            resourceType: result.resource_type,
            format: result.format,
            width: result.width,
            height: result.height,
          }),
    );
    stream.end(buffer);
  });
}

/** Deletes an uploaded file, whichever resource type it was stored as. */
export async function deleteImage(publicId) {
  for (const resource_type of ['image', 'raw', 'video']) {
    const r = await cloudinary.uploader.destroy(publicId, { resource_type });
    if (r.result === 'ok') return r;
  }
  return { result: 'not found' };
}
