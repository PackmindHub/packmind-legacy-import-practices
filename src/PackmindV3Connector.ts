import type { ValidationOutput } from './types.js';

/**
 * Payload structure of the decoded API key
 */
interface ApiKeyPayload {
  host: string;
  jwt: string;
}

/**
 * Result of decoding the API key
 */
interface DecodedApiKey {
  payload: ApiKeyPayload;
  isValid: boolean;
  error?: string;
}

/**
 * Response from the import-legacy endpoint
 */
export interface ImportLegacyResponse {
  success: boolean;
  message?: string;
  [key: string]: unknown;
}

/**
 * Decodes a base64-encoded API key containing host and JWT
 * @param apiKey - The base64-encoded API key
 * @returns DecodedApiKey with payload and validation status
 */
function decodeApiKey(apiKey: string): DecodedApiKey {
  if (!apiKey) {
    return {
      payload: { host: '', jwt: '' },
      isValid: false,
      error: 'Please set the PACKMIND_V3_API_KEY environment variable',
    };
  }

  try {
    const trimmedKey = apiKey.trim();
    const jsonString = Buffer.from(trimmedKey, 'base64').toString('utf-8');
    const payload = JSON.parse(jsonString) as ApiKeyPayload;

    if (!payload.host || typeof payload.host !== 'string') {
      return {
        payload: payload,
        isValid: false,
        error: 'Invalid API key: missing or invalid host field',
      };
    }

    if (!payload.jwt || typeof payload.jwt !== 'string') {
      return {
        payload: payload,
        isValid: false,
        error: 'Invalid API key: missing or invalid jwt field',
      };
    }

    return {
      payload,
      isValid: true,
    };
  } catch (error) {
    return {
      payload: { host: '', jwt: '' },
      isValid: false,
      error: `Failed to decode API key: ${error}`,
    };
  }
}

/**
 * Connector for Packmind V3 API operations
 */
export class PackmindV3Connector {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Imports legacy standards data to Packmind V3
   * @param data - The validation output data to import
   * @returns Promise resolving to the import response
   * @throws Error if API key is invalid or request fails
   */
  async importLegacy(data: ValidationOutput): Promise<ImportLegacyResponse> {
    // Decode the API key to get host
    const decodedApiKey = decodeApiKey(this.apiKey);
    if (!decodedApiKey.isValid) {
      throw new Error(`Invalid API key: ${decodedApiKey.error}`);
    }

    const { host } = decodedApiKey.payload;

    // Build the URL for the import-legacy endpoint
    const url = `${host}/api/v0/import-legacy`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        let errorMsg = `API request failed: ${response.status} ${response.statusText}`;
        try {
          const errorBody = await response.json();
          if (errorBody && typeof errorBody === 'object' && 'message' in errorBody) {
            errorMsg = `${errorBody.message}`;
          }
        } catch {
          // ignore if body is not json
        }
        const error: Error & { statusCode?: number } = new Error(errorMsg);
        error.statusCode = response.status;
        throw error;
      }

      const result = await response.json() as ImportLegacyResponse;
      return result;
    } catch (error: unknown) {
      // Specific handling if the server is not accessible
      const err = error as {
        code?: string;
        name?: string;
        message?: string;
        cause?: { code?: string };
        statusCode?: number;
      };
      const code = err?.code || err?.cause?.code;

      if (
        code === 'ECONNREFUSED' ||
        code === 'ENOTFOUND' ||
        err?.name === 'FetchError' ||
        (typeof err?.message === 'string' &&
          (err.message.includes('Failed to fetch') ||
            err.message.includes('network') ||
            err.message.includes('NetworkError')))
      ) {
        throw new Error(
          `Packmind V3 server is not accessible at ${host}. Please check your network connection or the server URL.`,
        );
      }

      // Re-throw if it's already a properly formatted error with statusCode
      if (err?.statusCode) {
        throw error;
      }

      throw new Error(
        `Failed to import legacy data: ${err?.message || JSON.stringify(error)}`,
      );
    }
  }
}

