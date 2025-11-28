import OpenAI from 'openai';
import { config } from 'dotenv';

// Load environment variables from .env file
config();

/**
 * Interface for LLM service that exposes a method to execute prompts
 */
export interface LLMServicePrompt {
  executePrompt(prompt: string): Promise<string>;
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

    this.client = new OpenAI({ apiKey });
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

