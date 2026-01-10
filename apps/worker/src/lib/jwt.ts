/**
 * JWT Token Utilities
 * 
 * Handles JWT creation and verification using Web Crypto API
 * compatible with Cloudflare Workers runtime.
 */

import type { JWTPayload, UserRole } from '@1cc/shared';
import { JWT_EXPIRY_SECONDS } from '@1cc/shared';

/**
 * Base64URL encode a string
 */
function base64urlEncode(data: string | ArrayBuffer): string {
  const str = typeof data === 'string' 
    ? data 
    : String.fromCharCode(...new Uint8Array(data));
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Base64URL decode a string
 */
function base64urlDecode(str: string): string {
  // Add padding if needed
  const padding = '='.repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  return atob(base64);
}

/**
 * Create HMAC signature using Web Crypto API
 */
async function createSignature(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  return base64urlEncode(signature);
}

/**
 * Verify HMAC signature
 */
async function verifySignature(
  data: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const expectedSignature = await createSignature(data, secret);
  return signature === expectedSignature;
}

/**
 * Create a JWT token
 */
export async function createJWT(
  payload: {
    userId: string;
    email: string;
    role: UserRole;
    organizationId: string | null;
  },
  secret: string,
  expiresIn: number = JWT_EXPIRY_SECONDS
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  
  const jwtPayload: JWTPayload = {
    sub: payload.userId,
    email: payload.email,
    role: payload.role,
    organizationId: payload.organizationId,
    iat: now,
    exp: now + expiresIn
  };
  
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(jwtPayload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;
  
  const signature = await createSignature(dataToSign, secret);
  
  console.log('[JWT] Token created for user:', payload.userId);
  
  return `${dataToSign}.${signature}`;
}

/**
 * Verify and decode a JWT token
 */
export async function verifyJWT(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    
    if (parts.length !== 3) {
      console.log('[JWT] Invalid token format');
      return null;
    }
    
    const [encodedHeader, encodedPayload, signature] = parts;
    const dataToVerify = `${encodedHeader}.${encodedPayload}`;
    
    // Verify signature
    const isValid = await verifySignature(dataToVerify, signature, secret);
    
    if (!isValid) {
      console.log('[JWT] Invalid signature');
      return null;
    }
    
    // Decode payload
    const payloadJson = base64urlDecode(encodedPayload);
    const payload: JWTPayload = JSON.parse(payloadJson);
    
    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      console.log('[JWT] Token expired');
      return null;
    }
    
    console.log('[JWT] Token verified for user:', payload.sub);
    return payload;
    
  } catch (error) {
    console.error('[JWT] Verification error:', error);
    return null;
  }
}

/**
 * Decode JWT without verification (for reading expired tokens)
 */
export function decodeJWT(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payloadJson = base64urlDecode(parts[1]);
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

/**
 * Get expiration date from token
 */
export function getTokenExpiration(token: string): Date | null {
  const payload = decodeJWT(token);
  if (!payload) return null;
  return new Date(payload.exp * 1000);
}

/**
 * Check if token is about to expire (within threshold)
 */
export function isTokenExpiringSoon(
  token: string,
  thresholdSeconds: number = 300 // 5 minutes
): boolean {
  const payload = decodeJWT(token);
  if (!payload) return true;
  
  const now = Math.floor(Date.now() / 1000);
  return payload.exp - now < thresholdSeconds;
}
