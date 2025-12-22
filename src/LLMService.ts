import OpenAI, { AzureOpenAI } from 'openai';
import { config } from 'dotenv';

// Load environment variables from .env file
config();

// Default Azure OpenAI API version
const DEFAULT_AZURE_OPENAI_API_VERSION = '2024-12-01-preview';

/**
 * Interface for LLM service that exposes a method to execute prompts
 */
export interface LLMServicePrompt {
  executePrompt(prompt: string): Promise<string>;
  getModel(): string;
}

/**
 * OpenAI implementation of the LLMServicePrompt interface
 */
export class OpenAIService implements LLMServicePrompt {
  private client: OpenAI;
  private model: string;

  constructor() {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set. Please create a .env file with your API key.');
    }

    const baseURL = process.env['OPENAI_URL'];
    
    this.client = new OpenAI({
      apiKey,
      ...(baseURL && { baseURL }), // Only include baseURL if defined and non-empty
    });
    this.model = process.env['OPENAI_MODEL'] || 'gpt-5.1';
  }

  /**
   * Executes a prompt using the OpenAI API
   * @param prompt - The prompt to send to the LLM
   * @returns The response content from the LLM
   */
  async executePrompt(prompt: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert software engineer specializing in categorizing coding practices and standards. You provide structured, consistent responses in YAML format.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3, // Lower temperature for more consistent categorization
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response content received from OpenAI');
      }

      return content;
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        throw new Error(`OpenAI API error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Returns the model being used
   */
  getModel(): string {
    return this.model;
  }
}

/**
 * Azure OpenAI implementation of the LLMServicePrompt interface.
 * Uses Azure-specific deployment model architecture where models are accessed
 * via deployment names rather than direct model identifiers.
 */
export class AzureOpenAIService implements LLMServicePrompt {
  private client: AzureOpenAI;
  private deployment: string;

  constructor() {
    const apiKey = process.env['AZURE_OPENAI_API_KEY'];
    const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
    const deployment = process.env['AZURE_OPENAI_DEPLOYMENT'];
    const apiVersion = process.env['AZURE_OPENAI_API_VERSION'] || DEFAULT_AZURE_OPENAI_API_VERSION;

    if (!apiKey) {
      throw new Error('AZURE_OPENAI_API_KEY environment variable is not set. Please create a .env file with your API key.');
    }
    if (!endpoint) {
      throw new Error('AZURE_OPENAI_ENDPOINT environment variable is not set. Please set it to your Azure OpenAI resource endpoint (e.g., https://my-resource.openai.azure.com).');
    }
    if (!deployment) {
      throw new Error('AZURE_OPENAI_DEPLOYMENT environment variable is not set. Please set it to your Azure OpenAI deployment name.');
    }

    this.client = new AzureOpenAI({
      apiKey,
      endpoint,
      apiVersion,
    });
    this.deployment = deployment;
  }

  /**
   * Executes a prompt using the Azure OpenAI API
   * @param prompt - The prompt to send to the LLM
   * @returns The response content from the LLM
   */
  async executePrompt(prompt: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.deployment,
        messages: [
          {
            role: 'system',
            content: 'You are an expert software engineer specializing in categorizing coding practices and standards. You provide structured, consistent responses in YAML format.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3, // Lower temperature for more consistent categorization
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response content received from Azure OpenAI');
      }

      return content;
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        throw new Error(`Azure OpenAI API error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Returns the deployment name being used
   */
  getModel(): string {
    return this.deployment;
  }
}

/**
 * Validates LLM configuration without instantiating the service.
 * Checks that all required environment variables are set for the configured provider.
 * 
 * @throws Error if LLM_PROVIDER is not set, has an invalid value, or required environment variables are missing
 * 
 * @example
 * ```typescript
 * // Validate before running pipeline
 * validateLLMConfiguration();
 * // If validation passes, proceed with pipeline
 * ```
 */
export function validateLLMConfiguration(): void {
  const provider = process.env['LLM_PROVIDER'];

  if (!provider) {
    throw new Error(
      'LLM_PROVIDER environment variable is not set. Please set it to "OPENAI" or "AZURE_OPENAI".'
    );
  }

  if (provider !== 'OPENAI' && provider !== 'AZURE_OPENAI') {
    throw new Error(
      `Invalid LLM_PROVIDER: "${provider}". Must be "OPENAI" or "AZURE_OPENAI".`
    );
  }

  if (provider === 'OPENAI') {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY environment variable is not set. Please create a .env file with your API key.'
      );
    }
  }

  if (provider === 'AZURE_OPENAI') {
    const apiKey = process.env['AZURE_OPENAI_API_KEY'];
    const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
    const deployment = process.env['AZURE_OPENAI_DEPLOYMENT'];

    if (!apiKey) {
      throw new Error(
        'AZURE_OPENAI_API_KEY environment variable is not set. Please create a .env file with your API key.'
      );
    }
    if (!endpoint) {
      throw new Error(
        'AZURE_OPENAI_ENDPOINT environment variable is not set. Please set it to your Azure OpenAI resource endpoint (e.g., https://my-resource.openai.azure.com).'
      );
    }
    if (!deployment) {
      throw new Error(
        'AZURE_OPENAI_DEPLOYMENT environment variable is not set. Please set it to your Azure OpenAI deployment name.'
      );
    }
  }
}

/**
 * Factory function to create the appropriate LLM service based on the LLM_PROVIDER environment variable.
 * 
 * @returns An instance of OpenAIService or AzureOpenAIService
 * @throws Error if LLM_PROVIDER is not set or has an invalid value
 * 
 * @example
 * ```typescript
 * // Set LLM_PROVIDER=OPENAI for OpenAI
 * // Set LLM_PROVIDER=AZURE_OPENAI for Azure OpenAI
 * const llmService = createLLMService();
 * const response = await llmService.executePrompt('Hello world');
 * ```
 */
export function createLLMService(): LLMServicePrompt {
  const provider = process.env['LLM_PROVIDER'];

  if (!provider) {
    throw new Error(
      'LLM_PROVIDER environment variable is not set. Please set it to "OPENAI" or "AZURE_OPENAI".'
    );
  }

  if (provider === 'OPENAI') {
    return new OpenAIService();
  }

  if (provider === 'AZURE_OPENAI') {
    return new AzureOpenAIService();
  }

  throw new Error(
    `Invalid LLM_PROVIDER: "${provider}". Must be "OPENAI" or "AZURE_OPENAI".`
  );
}
