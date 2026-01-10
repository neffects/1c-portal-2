/**
 * Local Storage Hook
 * 
 * Persist state in localStorage with SSR safety.
 */

import { useState, useEffect } from 'preact/hooks';

/**
 * Hook to persist state in localStorage
 */
export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // Initialize state
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue;
    }
    
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error('[useLocalStorage] Read error:', error);
      return initialValue;
    }
  });
  
  // Update localStorage when value changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
      console.log('[useLocalStorage] Saved:', key);
    } catch (error) {
      console.error('[useLocalStorage] Write error:', error);
    }
  }, [key, storedValue]);
  
  return [storedValue, setStoredValue];
}

/**
 * Hook to read from localStorage without persistence
 */
export function useReadLocalStorage<T>(key: string): T | null {
  const [value, setValue] = useState<T | null>(null);
  
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      const item = window.localStorage.getItem(key);
      setValue(item ? JSON.parse(item) : null);
    } catch (error) {
      console.error('[useReadLocalStorage] Error:', error);
      setValue(null);
    }
  }, [key]);
  
  return value;
}
