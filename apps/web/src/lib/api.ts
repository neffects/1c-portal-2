/**
 * API Client
 * 
 * Handles HTTP requests to the backend API.
 * Includes authentication header injection and error handling.
 */

import { getAuthToken } from '../stores/auth';

// API base URL - uses proxy in development
const API_BASE = '';

/**
 * API response wrapper type
 */
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * Build request headers with auth token
 */
function getHeaders(): HeadersInit {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/web/src/lib/api.ts:29',message:'getHeaders called',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  const headers: HeadersInit = {
    'Content-Type': 'application/json'
  };
  
  const token = getAuthToken();
  
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/c431055f-f878-4642-bb59-8869e38c7e8b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/web/src/lib/api.ts:34',message:'getAuthToken result',data:{tokenExists:!!token,tokenLength:token?.length,hasAuthHeader:!!headers['Authorization']},timestamp:Date.now(),sessionId:'debug-session',runId:'initial',hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
}

/**
 * Make a GET request
 */
async function get<T>(path: string): Promise<ApiResponse<T>> {
  console.log('[API] GET', path);
  
  try {
    const headers = getHeaders();
    
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers
    });
    
    // Read response as text first (can only read body once)
    const text = await response.text();
    
    // Try to parse as JSON
    let data: ApiResponse<T>;
    try {
      // Handle empty response
      if (!text || text.trim() === '') {
        console.error('[API] GET empty response:', path);
        return {
          success: false,
          error: {
            code: 'PARSE_ERROR',
            message: 'Server returned empty response'
          }
        };
      }
      
      data = JSON.parse(text);
    } catch (parseError) {
      // If response is not JSON, return error with status
      console.error('[API] GET JSON parse error:', path, parseError);
      console.error('[API] GET response text (first 500 chars):', text.substring(0, 500));
      console.error('[API] GET response headers:', Object.fromEntries(response.headers.entries()));
      console.error('[API] GET response content-type:', response.headers.get('content-type'));
      return {
        success: false,
        error: {
          code: 'PARSE_ERROR',
          message: `Server returned non-JSON response (${response.status} ${response.statusText}). Check console for details.`
        }
      };
    }
    
    if (!response.ok) {
      console.error('[API] GET error:', path, response.status, data);
    }
    
    return data;
  } catch (error) {
    console.error('[API] GET fetch error:', path, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: `Network request failed: ${errorMessage}`
      }
    };
  }
}

/**
 * Make a POST request
 */
async function post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  console.log('[API] POST', path);
  
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: getHeaders(),
      body: body ? JSON.stringify(body) : undefined
    });
    
    // Read response as text first (can only read body once)
    const text = await response.text();
    
    // Try to parse as JSON
    let data: ApiResponse<T>;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.error('[API] POST JSON parse error:', path, parseError);
      console.error('[API] POST response text:', text.substring(0, 200));
      return {
        success: false,
        error: {
          code: 'PARSE_ERROR',
          message: `Server returned non-JSON response (${response.status} ${response.statusText})`
        }
      };
    }
    
    if (!response.ok) {
      console.error('[API] POST error:', path, response.status, data);
    }
    
    return data;
  } catch (error) {
    console.error('[API] POST fetch error:', path, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: `Network request failed: ${errorMessage}`
      }
    };
  }
}

/**
 * Make a PATCH request
 */
async function patch<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  console.log('[API] PATCH', path);
  
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(body)
    });
    
    // Read response as text first (can only read body once)
    const text = await response.text();
    
    // Try to parse as JSON
    let data: ApiResponse<T>;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.error('[API] PATCH JSON parse error:', path, parseError);
      console.error('[API] PATCH response text:', text.substring(0, 200));
      return {
        success: false,
        error: {
          code: 'PARSE_ERROR',
          message: `Server returned non-JSON response (${response.status} ${response.statusText})`
        }
      };
    }
    
    if (!response.ok) {
      console.error('[API] PATCH error:', path, response.status, data);
    }
    
    return data;
  } catch (error) {
    console.error('[API] PATCH fetch error:', path, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: `Network request failed: ${errorMessage}`
      }
    };
  }
}

/**
 * Make a DELETE request
 */
async function del<T>(path: string): Promise<ApiResponse<T>> {
  console.log('[API] DELETE', path);
  
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    
    // Read response as text first (can only read body once)
    const text = await response.text();
    
    // Try to parse as JSON
    let data: ApiResponse<T>;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.error('[API] DELETE JSON parse error:', path, parseError);
      console.error('[API] DELETE response text:', text.substring(0, 200));
      return {
        success: false,
        error: {
          code: 'PARSE_ERROR',
          message: `Server returned non-JSON response (${response.status} ${response.statusText})`
        }
      };
    }
    
    if (!response.ok) {
      console.error('[API] DELETE error:', path, response.status, data);
    }
    
    return data;
  } catch (error) {
    console.error('[API] DELETE fetch error:', path, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: `Network request failed: ${errorMessage}`
      }
    };
  }
}

/**
 * Upload a file
 */
async function upload<T>(path: string, formData: FormData): Promise<ApiResponse<T>> {
  console.log('[API] UPLOAD', path);
  
  try {
    const token = getAuthToken();
    const headers: HeadersInit = {};
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Note: Don't set Content-Type header - browser will set it with boundary
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: formData
    });
    
    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error('[API] UPLOAD JSON parse error:', path, parseError);
      const text = await response.text();
      console.error('[API] UPLOAD response text:', text);
      return {
        success: false,
        error: {
          code: 'PARSE_ERROR',
          message: 'Failed to parse server response'
        }
      };
    }
    
    if (!response.ok) {
      console.error('[API] UPLOAD error:', path, response.status, data);
      return {
        success: false,
        error: data.error || {
          code: 'UPLOAD_ERROR',
          message: data.message || `Upload failed with status ${response.status}`
        }
      };
    }
    
    return data;
  } catch (error) {
    console.error('[API] UPLOAD fetch error:', path, error);
    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'File upload failed'
      }
    };
  }
}

// Export API methods
export const api = {
  get,
  post,
  patch,
  delete: del,
  upload
};
