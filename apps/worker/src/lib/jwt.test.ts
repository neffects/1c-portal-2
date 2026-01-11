/**
 * JWT Library Tests
 * 
 * Unit tests for JWT signing and verification.
 * Updated for multi-org architecture where JWT contains minimal payload (sub + email only).
 */

import { describe, it, expect } from 'vitest';
import { createJWT, verifyJWT, decodeJWT, isTokenExpiringSoon, getTokenExpiration } from './jwt';

const TEST_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';

describe('JWT Library', () => {
  describe('createJWT', () => {
    it('should create a valid JWT token', async () => {
      const token = await createJWT({
        userId: 'user-123',
        email: 'test@example.com'
      }, TEST_SECRET);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // Header.Payload.Signature
    });
    
    it('should include userId and email in token', async () => {
      const token = await createJWT({
        userId: 'user-123',
        email: 'test@example.com'
      }, TEST_SECRET);
      
      const decoded = decodeJWT(token);
      
      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe('user-123');
      expect(decoded?.email).toBe('test@example.com');
    });
    
    it('should NOT include role or organizationId in token (new architecture)', async () => {
      const token = await createJWT({
        userId: 'user-123',
        email: 'test@example.com'
      }, TEST_SECRET);
      
      const decoded = decodeJWT(token);
      
      expect(decoded).not.toBeNull();
      // These should NOT exist in the new minimal JWT
      // Type assertion through unknown to check these don't exist
      const decodedAny = decoded as unknown as Record<string, unknown>;
      expect(decodedAny.role).toBeUndefined();
      expect(decodedAny.organizationId).toBeUndefined();
    });
    
    it('should set expiration time', async () => {
      const token = await createJWT({
        userId: 'user-123',
        email: 'test@example.com'
      }, TEST_SECRET, 3600); // 1 hour
      
      const decoded = decodeJWT(token);
      
      expect(decoded?.exp).toBeDefined();
      expect(decoded?.iat).toBeDefined();
      
      // Expiration should be ~1 hour from now
      const expTime = decoded!.exp * 1000;
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      
      expect(expTime).toBeGreaterThan(now);
      expect(expTime).toBeLessThan(now + oneHour + 1000); // Allow 1s tolerance
    });
  });
  
  describe('verifyJWT', () => {
    it('should verify valid token', async () => {
      const token = await createJWT({
        userId: 'user-123',
        email: 'test@example.com'
      }, TEST_SECRET);
      
      const verified = await verifyJWT(token, TEST_SECRET);
      
      expect(verified).not.toBeNull();
      expect(verified?.sub).toBe('user-123');
      expect(verified?.email).toBe('test@example.com');
    });
    
    it('should return null for token with wrong secret', async () => {
      const token = await createJWT({
        userId: 'user-123',
        email: 'test@example.com'
      }, TEST_SECRET);
      
      const verified = await verifyJWT(token, 'wrong-secret-key-that-is-at-least-32-chars');
      expect(verified).toBeNull();
    });
    
    it('should return null for malformed token', async () => {
      const verified1 = await verifyJWT('invalid.token', TEST_SECRET);
      const verified2 = await verifyJWT('not-a-jwt', TEST_SECRET);
      const verified3 = await verifyJWT('', TEST_SECRET);
      
      expect(verified1).toBeNull();
      expect(verified2).toBeNull();
      expect(verified3).toBeNull();
    });
  });
  
  describe('decodeJWT', () => {
    it('should decode token without verification', async () => {
      const token = await createJWT({
        userId: 'user-123',
        email: 'test@example.com'
      }, TEST_SECRET);
      
      const decoded = decodeJWT(token);
      
      expect(decoded?.sub).toBe('user-123');
      expect(decoded?.email).toBe('test@example.com');
    });
    
    it('should return null for invalid token', () => {
      const decoded = decodeJWT('invalid-token');
      expect(decoded).toBeNull();
    });
  });
  
  describe('getTokenExpiration', () => {
    it('should return expiration date', async () => {
      const token = await createJWT({
        userId: 'user-123',
        email: 'test@example.com'
      }, TEST_SECRET, 3600);
      
      const expiration = getTokenExpiration(token);
      
      expect(expiration).toBeInstanceOf(Date);
      expect(expiration!.getTime()).toBeGreaterThan(Date.now());
    });
    
    it('should return null for invalid token', () => {
      const expiration = getTokenExpiration('invalid-token');
      expect(expiration).toBeNull();
    });
  });
  
  describe('isTokenExpiringSoon', () => {
    it('should return false for fresh token', async () => {
      const token = await createJWT({
        userId: 'user-123',
        email: 'test@example.com'
      }, TEST_SECRET, 86400); // 24 hours
      
      const expiring = isTokenExpiringSoon(token);
      expect(expiring).toBe(false);
    });
    
    it('should return true for token expiring soon', async () => {
      const token = await createJWT({
        userId: 'user-123',
        email: 'test@example.com'
      }, TEST_SECRET, 60); // 1 minute
      
      const expiring = isTokenExpiringSoon(token, 3600); // Threshold 1 hour
      expect(expiring).toBe(true);
    });
  });
});
