/**
 * File Upload Routes
 * 
 * Handles file uploads to R2 storage.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { requireAbility } from '../middleware/casl';
import { writeFile, readFile, headFile, deleteFile } from '../lib/r2';
import type { Env, Context } from '../types';

const files = new Hono<{ Bindings: Env }>();

// Auth middleware for upload and delete operations only
// GET is public for serving images/files

/**
 * Upload a file
 * POST /files/upload
 */
files.post('/upload',
  authMiddleware,
  requireAbility('write', 'Platform'),
  async (c: Context) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }
  
  const ability = c.get('ability');
  if (!ability) {
    return c.json({ success: false, error: { message: 'CASL ability required' } }, 401);
  }
  
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    const type = formData.get('type') as string || 'file';
    
    if (!file) {
      return c.json({ success: false, error: { message: 'No file provided' } }, 400);
    }
    
    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return c.json({ 
        success: false, 
        error: { message: `File too large. Maximum size: ${maxSize / 1024 / 1024}MB` } 
      }, 400);
    }
    
    // Generate unique filename
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const extension = file.name.split('.').pop() || 'bin';
    const filename = `${timestamp}-${random}.${extension}`;
    
    // Determine storage path based on type
    let path: string;
    switch (type) {
      case 'image':
        path = `uploads/images/${filename}`;
        break;
      case 'logo':
        path = `uploads/logos/${filename}`;
        break;
      case 'favicon':
        path = `uploads/favicons/${filename}`;
        break;
      default:
        path = `uploads/files/${filename}`;
    }
    
    // Upload to R2 using CASL-aware function
    const arrayBuffer = await file.arrayBuffer();
    await writeFile(
      c.env.R2_BUCKET,
      path,
      arrayBuffer,
      ability,
      {
        originalName: file.name,
        uploadedBy: user.id,
        uploadedAt: new Date().toISOString()
      },
      file.type
    );
    
    // Generate public URL
    const publicUrl = `/files/${path}`;
    
    console.log(`[Files] Uploaded ${file.name} to ${path} by user ${user.id}`);
    
    return c.json({
      success: true,
      data: {
        url: publicUrl,
        path,
        name: file.name,
        size: file.size,
        type: file.type
      }
    });
    
  } catch (error) {
    console.error('[Files] Upload error:', error);
    return c.json({ 
      success: false, 
      error: { message: error instanceof Error ? error.message : 'Upload failed' } 
    }, 500);
  }
});

/**
 * Get a file
 * GET /files/:path+
 * Security: Only allows access to files in uploads/ prefix
 * Public access (no auth required) but CASL still checks path
 */
files.get('/:path{.+}', async (c: Context) => {
  const path = c.req.param('path');
  
  // Security: Only allow access to uploads/ prefix
  if (!path.startsWith('uploads/')) {
    console.warn('[Files] Attempted access to non-uploads path:', path);
    return c.json({ 
      success: false, 
      error: { code: 'FORBIDDEN', message: 'Access denied' } 
    }, 403);
  }
  
  try {
    // Use CASL-aware readFile (uploads/ paths are public, so ability can be null)
    const object = await readFile(c.env.R2_BUCKET, path, null);
    
    if (!object) {
      return c.json({ success: false, error: { message: 'File not found' } }, 404);
    }
    
    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=31536000'); // 1 year cache
    
    // Add CORS headers for images
    headers.set('Access-Control-Allow-Origin', '*');
    
    return new Response(object.body, { headers });
    
  } catch (error) {
    console.error('[Files] Get error:', error);
    return c.json({ 
      success: false, 
      error: { message: 'Failed to retrieve file' } 
    }, 500);
  }
});

/**
 * Delete a file
 * DELETE /files/:path+
 */
files.delete('/:path{.+}',
  authMiddleware,
  requireAbility('delete', 'Platform'),
  async (c: Context) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ success: false, error: { message: 'Unauthorized' } }, 401);
  }
  
  const ability = c.get('ability');
  if (!ability) {
    return c.json({ success: false, error: { message: 'CASL ability required' } }, 401);
  }
  
  const path = c.req.param('path');
  
  try {
    // Check if file exists and user has permission
    const object = await headFile(c.env.R2_BUCKET, path, ability);
    
    if (!object) {
      return c.json({ success: false, error: { message: 'File not found' } }, 404);
    }
    
    // Only allow deletion by uploader or superadmin
    const uploadedBy = object.customMetadata?.uploadedBy;
    if (uploadedBy !== user.id && user.role !== 'superadmin') {
      return c.json({ success: false, error: { message: 'Not authorized to delete this file' } }, 403);
    }
    
    // Use CASL-aware deleteFile
    await deleteFile(c.env.R2_BUCKET, path, ability, 'delete', 'Platform');
    
    console.log(`[Files] Deleted ${path} by user ${user.id}`);
    
    return c.json({ success: true, data: { path } });
    
  } catch (error) {
    console.error('[Files] Delete error:', error);
    return c.json({ 
      success: false, 
      error: { message: 'Failed to delete file' } 
    }, 500);
  }
});

export default files;
