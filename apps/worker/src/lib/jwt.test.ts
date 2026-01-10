/**
 * JWT Library Tests
 * 
 * Unit tests for JWT signing and verification.
 */

import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt, decodeJwt } from './jwt';

const TEST_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';

describe('JWT Library', () => {
  describe('signJwt', () => {
    it('should create a valid JWT token', async () => {
      const payload = {
        userId: 'user-123',
        role: 'superadmin'
      };
      
      const token = await signJwt(payload, TEST_SECRET, '1h');
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // Header.Payload.Signature
    });
    
    it('should include payload in token', async () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com',
        role: 'org_admin'
      };
      
      const token = await signJwt(payload, TEST_SECRET, '1h');
      const decoded = decodeJwt(token);
      
      expect(decoded.userId).toBe('user-123');
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.role).toBe('org_admin');
    });
    
    it('should set expiration time', async () => {
      const payload = { userId: 'user-123' };
      const token = await signJwt(payload, TEST_SECRET, '1h');
      const decoded = decodeJwt(token);
      
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
      
      // Expiration should be ~1 hour from now
      const expTime = decoded.exp * 1000;
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      
      expect(expTime).toBeGreaterThan(now);
      expect(expTime).toBeLessThan(now + oneHour + 1000); // Allow 1s tolerance
    });
  });
  
  describe('verifyJwt', () => {
    it('should verify valid token', async () => {
      const payload = {
        userId: 'user-123',
        role: 'superadmin'
      };
      
      const token = await signJwt(payload, TEST_SECRET, '1h');
      const verified = await verifyJwt(token, TEST_SECRET);
      
      expect(verified.userId).toBe('user-123');
      expect(verified.role).toBe('superadmin');
    });
    
    it('should reject token with wrong secret', async () => {
      const payload = { userId: 'user-123' };
      const token = await signJwt(payload, TEST_SECRET, '1h');
      
      await expect(verifyJwt(token, 'wrong-secret-key-that-is-at-least-32-chars')).rejects.toThrow();
    });
    
    it('should reject expired token', async () => {
      const payload = { userId: 'user-123' };
      const token = await signJwt(payload, TEST_SECRET, '-1h'); // Already expired
      
      await expect(verifyJwt(token, TEST_SECRET)).rejects.toThrow();
    });
    
    it('should reject malformed token', async () => {
      await expect(verifyJwt('invalid.token', TEST_SECRET)).rejects.toThrow();
      await expect(verifyJwt('not-a-jwt', TEST_SECRET)).rejects.toThrow();
      await expect(verifyJwt('', TEST_SECRET)).rejects.toThrow();
    });
    
    it('should reject tampered token', async () => {
      const payload = { userId: 'user-123', role: 'org_member' };
      const token = await signJwt(payload, TEST_SECRET, '1h');
      
      // Tamper with the payload
      const parts = token.split('.');
      const decodedPayload = JSON.parse(atob(parts[1]));
      decodedPayload.role = 'superadmin'; // Try to escalate privileges
      parts[1] = btoa(JSON.stringify(decodedPayload));
      const tamperedToken = parts.join('.');
      
      await expect(verifyJwt(tamperedToken, TEST_SECRET)).rejects.toThrow();
    });
  });
  
  describe('decodeJwt', () => {
    it('should decode token without verification', async () => {
      const payload = {
        userId: 'user-123',
        email: 'test@example.com'
      };
      
      const token = await signJwt(payload, TEST_SECRET, '1h');
      const decoded = decodeJwt(token);
      
      expect(decoded.userId).toBe('user-123');
      expect(decoded.email).toBe('test@example.com');
    });
    
    it('should return null for invalid token', () => {
      const decoded = decodeJwt('invalid-token');
      expect(decoded).toBeNull();
    });
  });
});
