import { jwtDecode } from 'jwt-decode';

// ============================================================================
// Types
// ============================================================================

export interface Space {
  _id: string;
  name: string;
}

interface JwtPayload {
  host: string;
  secure: boolean;
}

// ============================================================================
// API Key Utilities
// ============================================================================

/**
 * Extracts server configuration from the API key
 * The API key is base64-encoded, containing a JWT with host and secure fields
 */
function extractServerConfigurationFromApiKey(apiKey: string): { host: string; secure: boolean } {
  // Try direct JWT decode first (if key is already a JWT)
  // Then fall back to base64 decode + JWT decode
  try {
    const { host, secure } = jwtDecode<JwtPayload>(apiKey);
    if (host && typeof secure === 'boolean') {
      return { host, secure };
    }
  } catch {
    // Direct decode failed, try base64 unwrap
  }

  // Try base64 decode then JWT decode
  try {
    const apiKeyDecoded = Buffer.from(apiKey, 'base64').toString();
    const { host, secure } = jwtDecode<JwtPayload>(apiKeyDecoded);
    if (host && typeof secure === 'boolean') {
      return { host, secure };
    }
  } catch {
    // Base64 + JWT decode also failed
  }

  throw new Error('Your API Key seems to be invalid. Please check it and try again.');
}

/**
 * Gets the base URL from the API key
 */
export function getBaseUrl(apiKey: string): string {
  const { host, secure } = extractServerConfigurationFromApiKey(apiKey);
  const protocol = secure ? 'https' : 'http';

  if (host.endsWith('/')) {
    return `${protocol}://${host.slice(0, -1)}`;
  }
  return `${protocol}://${host}`;
}

// ============================================================================
// Packmind API Client
// ============================================================================

export class PackmindAPI {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = getBaseUrl(apiKey);
  }

  /**
   * Fetches available spaces from the Packmind server
   */
  async getSpaces(): Promise<Space[]> {
    const url = `${this.baseUrl}/api/plugin/common/space`;
    console.log('url', url);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'promyze-api-key': this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<Space[]>;
  }
}

