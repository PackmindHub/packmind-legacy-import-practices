import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import type {
  ParsedPractice,
  DetectionUnitTest,
  Example,
  FileContent,
  SpaceMapping,
  ValidatedExample,
  ValidatedRule,
  ValidatedStandard,
  ValidationOutput,
  DetectionProgram,
} from './types.js';
import { ProgrammingLanguage, ProgrammingLanguageDetails } from './ProgrammingLanguage.js';

// ============================================================================
// Types for Standards Mapping YAML
// ============================================================================

interface StandardMapping {
  name: string;
  description: string;
  practices: string[];
}

interface StandardsMappingFile {
  standards: StandardMapping[];
}

// ============================================================================
// Configuration
// ============================================================================

export interface PracticeToStandardConvertorConfig {
  spacesJsonPath: string;
  standardsMappingPath: string;
  contextLines: number;
}

// ============================================================================
// Comment Style Types and Functions
// ============================================================================

/**
 * Represents the comment style for a programming language
 * - prefix: The string that starts a comment (e.g., "//", "#", "<!--")
 * - suffix: Optional string that ends a comment (e.g., "-->"), only for block-style comments
 */
export interface CommentStyle {
  prefix: string;
  suffix?: string;
}

/**
 * Gets the comment style for a given ProgrammingLanguage enum value.
 * Returns null for languages that don't support comments (e.g., JSON).
 * 
 * @param language - The ProgrammingLanguage enum value (e.g., "KOTLIN", "PYTHON")
 * @returns CommentStyle object with prefix and optional suffix, or null if no comments supported
 */
export function getCommentStyleForLanguage(language: string): CommentStyle | null {
  // Languages using // style comments
  const slashSlashLanguages = [
    ProgrammingLanguage.JAVASCRIPT,
    ProgrammingLanguage.JAVASCRIPT_JSX,
    ProgrammingLanguage.TYPESCRIPT,
    ProgrammingLanguage.TYPESCRIPT_TSX,
    ProgrammingLanguage.PHP,
    ProgrammingLanguage.JAVA,
    ProgrammingLanguage.CSHARP,
    ProgrammingLanguage.GO,
    ProgrammingLanguage.C,
    ProgrammingLanguage.CPP,
    ProgrammingLanguage.KOTLIN,
    ProgrammingLanguage.SCSS,
    ProgrammingLanguage.CSS,
    ProgrammingLanguage.RUST,
    ProgrammingLanguage.SWIFT,
    ProgrammingLanguage.SAP_CDS,
    ProgrammingLanguage.VUE,
    ProgrammingLanguage.GENERIC,
  ];

  // Languages using # style comments
  const hashLanguages = [
    ProgrammingLanguage.PYTHON,
    ProgrammingLanguage.YAML,
    ProgrammingLanguage.BASH,
    ProgrammingLanguage.RUBY,
    ProgrammingLanguage.PROPERTIES,
  ];

  // Languages using -- style comments
  const doubleDashLanguages = [
    ProgrammingLanguage.SQL,
    ProgrammingLanguage.SAP_HANA_SQL,
  ];

  // Languages using <!-- --> style comments
  const htmlStyleLanguages = [
    ProgrammingLanguage.HTML,
    ProgrammingLanguage.XML,
    ProgrammingLanguage.MARKDOWN,
  ];

  // Languages using * at start of line (ABAP style)
  const asteriskLanguages = [
    ProgrammingLanguage.SAP_ABAP,
  ];

  // Languages with no comment support
  const noCommentLanguages = [
    ProgrammingLanguage.JSON,
  ];

  if (slashSlashLanguages.includes(language as ProgrammingLanguage)) {
    return { prefix: '//' };
  }

  if (hashLanguages.includes(language as ProgrammingLanguage)) {
    return { prefix: '#' };
  }

  if (doubleDashLanguages.includes(language as ProgrammingLanguage)) {
    return { prefix: '--' };
  }

  if (htmlStyleLanguages.includes(language as ProgrammingLanguage)) {
    return { prefix: '<!--', suffix: '-->' };
  }

  if (asteriskLanguages.includes(language as ProgrammingLanguage)) {
    return { prefix: '*' };
  }

  if (noCommentLanguages.includes(language as ProgrammingLanguage)) {
    return null;
  }

  // Default to // style for unknown languages
  return { prefix: '//' };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Checks if a practice has valid detection that should be included
 * Detection is valid when:
 * - toolings.status === "SUCCESS"
 * - suggestionsDisabled === false
 */
export function shouldIncludeDetection(practice: ParsedPractice): boolean {
  if (practice.suggestionsDisabled) {
    return false;
  }
  
  if (!practice.toolings) {
    return false;
  }
  
  return practice.toolings.status === 'SUCCESS';
}

/**
 * Adds the description as a comment header to the code (legacy function using file extensions)
 * @deprecated Use addDescriptionAsCommentForLanguage instead
 */
export function addDescriptionAsComment(code: string, description: string, language: string): string {
  if (!description || description.trim() === '') {
    return code;
  }
  
  // Determine comment style based on language
  const commentPrefix = getCommentPrefix(language);
  const commentedDescription = description
    .split('\n')
    .map(line => `${commentPrefix} ${line}`)
    .join('\n');
  
  return `${commentedDescription}\n${code}`;
}

/**
 * Gets the comment prefix for a given language (legacy function using file extensions)
 * @deprecated Use getCommentStyleForLanguage instead
 */
function getCommentPrefix(language: string): string {
  const singleLineCommentLanguages = ['kt', 'java', 'js', 'ts', 'tsx', 'jsx', 'swift', 'go', 'c', 'cpp', 'cs'];
  const hashCommentLanguages = ['py', 'python', 'rb', 'ruby', 'sh', 'bash', 'yaml', 'yml'];
  
  if (singleLineCommentLanguages.includes(language.toLowerCase())) {
    return '//';
  }
  if (hashCommentLanguages.includes(language.toLowerCase())) {
    return '#';
  }
  return '//'; // Default to // style
}

/**
 * Adds the description as a comment header to the code using ProgrammingLanguage enum values.
 * Supports both single-line comments (e.g., //, #, --) and multi-line comments (e.g., <!-- -->).
 * Returns the original code unchanged if:
 * - The description is empty
 * - The language doesn't support comments (e.g., JSON)
 * 
 * @param code - The source code to prepend the comment to
 * @param description - The description text to convert to a comment
 * @param programmingLanguage - The ProgrammingLanguage enum value (e.g., "KOTLIN", "HTML")
 * @returns The code with the description prepended as a comment
 */
export function addDescriptionAsCommentForLanguage(
  code: string,
  description: string,
  programmingLanguage: string
): string {
  if (!description || description.trim() === '') {
    return code;
  }

  const commentStyle = getCommentStyleForLanguage(programmingLanguage);
  
  // If the language doesn't support comments, return code unchanged
  if (!commentStyle) {
    return code;
  }

  const lines = description.split('\n');

  // Handle multi-line comment style (e.g., HTML/XML <!-- -->)
  if (commentStyle.suffix) {
    // For multi-line descriptions, wrap each line individually for readability
    const commentedLines = lines
      .map(line => `${commentStyle.prefix} ${line} ${commentStyle.suffix}`)
      .join('\n');
    return `${commentedLines}\n${code}`;
  }

  // Handle single-line comment style (e.g., //, #, --, *)
  const commentedDescription = lines
    .map(line => `${commentStyle.prefix} ${line}`)
    .join('\n');

  return `${commentedDescription}\n${code}`;
}

/**
 * Converts a file extension to a ProgrammingLanguage string value.
 * @param extension - The file extension (e.g., "kt", "java", "py")
 * @returns The ProgrammingLanguage string value (e.g., "KOTLIN", "JAVA", "PYTHON")
 *          Falls back to "GENERIC" for unknown extensions
 */
export function convertProgrammingLanguage(extension: string): string {
  if (!extension || extension.trim() === '') {
    return ProgrammingLanguage.GENERIC;
  }

  const lowerExtension = extension.trim().toLowerCase();

  // Search through ProgrammingLanguageDetails to find a match by file extension
  for (const [language, info] of Object.entries(ProgrammingLanguageDetails)) {
    if (info.fileExtensions.some((ext) => ext.toLowerCase() === lowerExtension)) {
      return language;
    }
  }

  // Fallback to GENERIC for unknown extensions
  return ProgrammingLanguage.GENERIC;
}

// ============================================================================
// Practice to Standard Convertor
// ============================================================================

export class PracticeToStandardConvertor {
  private config: PracticeToStandardConvertorConfig;
  private spacesMap: Map<string, string> = new Map(); // ObjectId -> name
  private standardsMapping: StandardMapping[] = [];
  private practiceToStandard: Map<string, string> = new Map(); // practice name -> standard name

  constructor(config: PracticeToStandardConvertorConfig) {
    this.config = config;
  }

  /**
   * Loads the spaces mapping from spaces.json
   */
  loadSpacesMapping(): void {
    const content = readFileSync(this.config.spacesJsonPath, 'utf-8');
    const spaces: SpaceMapping[] = JSON.parse(content);
    
    this.spacesMap.clear();
    for (const space of spaces) {
      this.spacesMap.set(space._id, space.name);
    }
  }

  /**
   * Loads the standards mapping from standards-mapping.yaml
   */
  loadStandardsMapping(): void {
    const content = readFileSync(this.config.standardsMappingPath, 'utf-8');
    const data = yaml.load(content) as StandardsMappingFile;
    
    this.standardsMapping = data.standards || [];
    
    // Build reverse lookup: practice name -> standard name
    this.practiceToStandard.clear();
    for (const standard of this.standardsMapping) {
      for (const practiceName of standard.practices) {
        this.practiceToStandard.set(practiceName.toLowerCase().trim(), standard.name);
      }
    }
  }

  /**
   * Gets the space name for a given space ObjectId
   */
  getSpaceName(spaceId: string): string {
    return this.spacesMap.get(spaceId) || 'Unknown Space';
  }

  /**
   * Gets the standard name for a given practice name
   */
  getStandardForPractice(practiceName: string): string | undefined {
    return this.practiceToStandard.get(practiceName.toLowerCase().trim());
  }

  /**
   * Extracts lines from contents array within the specified range (inclusive)
   */
  private getLineRange(contents: FileContent[], startLine: number, endLine: number): string {
    return contents
      .filter((c) => c.line >= startLine && c.line <= endLine)
      .sort((a, b) => a.line - b.line)
      .map((c) => c.content)
      .join('\n');
  }

  /**
   * Extracts code from an example's position with context lines before and after
   */
  extractCodeWithContext(example: Example): string {
    const contents = example.fileWorkshop.contents;
    const beginLine = example.position.begin.line;
    const endLine = example.position.end.line;

    // Calculate min and max line numbers from contents
    const minLine = Math.min(...contents.map((c) => c.line));
    const maxLine = Math.max(...contents.map((c) => c.line));

    // Add context lines, clamped to file bounds
    const startLine = Math.max(minLine, beginLine - this.config.contextLines);
    const stopLine = Math.min(maxLine, endLine + this.config.contextLines);

    return this.getLineRange(contents, startLine, stopLine);
  }

  /**
   * Infers the primary language from a practice's examples
   */
  private inferLanguage(practice: ParsedPractice): string {
    const languages = practice.examples
      .map((ex) => ex.fileWorkshop?.lang)
      .filter((lang): lang is string => Boolean(lang));

    if (languages.length === 0) {
      return 'unknown';
    }

    // Return most common language
    const langCount = new Map<string, number>();
    for (const lang of languages) {
      langCount.set(lang, (langCount.get(lang) ?? 0) + 1);
    }

    return [...langCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
  }

  /**
   * Checks if all examples in a practice use AVRO file extensions (avdl, avsc, avpr)
   */
  private areAllExamplesAvro(practice: ParsedPractice): boolean {
    const avroExtensions = ['avdl', 'avsc', 'avpr'];
    const languages = practice.examples
      .map((ex) => ex.fileWorkshop?.lang?.toLowerCase())
      .filter((lang): lang is string => Boolean(lang));
    
    if (languages.length === 0) {
      return false;
    }
    
    return languages.every(lang => avroExtensions.includes(lang));
  }

  /**
   * Converts a detection unit test to a validated example
   * Adds description as a comment header in the code using the ProgrammingLanguage enum
   */
  convertUnitTestToExample(test: DetectionUnitTest, language: string): ValidatedExample {
    // Convert file extension to ProgrammingLanguage enum value
    const programmingLanguage = convertProgrammingLanguage(language);
    
    // Normalize description: treat empty or whitespace-only as undefined
    const trimmedDescription = test.description?.trim();
    const hasDescription = trimmedDescription && trimmedDescription.length > 0;
    
    // Add description as comment only if it has actual content
    const code = hasDescription
      ? addDescriptionAsCommentForLanguage(test.code, trimmedDescription, programmingLanguage)
      : test.code;
    
    return {
      code,
      language: programmingLanguage,
    };
  }

  /**
   * Converts a file workshop example to a validated example
   */
  convertFileWorkshopExample(example: Example): ValidatedExample {
    return {
      code: this.extractCodeWithContext(example),
      language: convertProgrammingLanguage(example.fileWorkshop?.lang || ''),
    };
  }

  /**
   * Converts a practice to a validated rule
   */
  convertPracticeToRule(practice: ParsedPractice): ValidatedRule {
    const includeDetection = shouldIncludeDetection(practice);
    const inferredLanguage = this.inferLanguage(practice);
    
    const positiveExamples: ValidatedExample[] = [];
    const negativeExamples: ValidatedExample[] = [];
    
    // Process unit tests (only if detection is valid)
    if (includeDetection && practice.detectionUnitTests) {
      for (const test of practice.detectionUnitTests) {
        const example = this.convertUnitTestToExample(test, inferredLanguage);
        if (test.isCompliant) {
          positiveExamples.push(example);
        } else {
          negativeExamples.push(example);
        }
      }
    }
    
    // Process file workshop examples (always included)
    for (const example of practice.examples) {
      if (example.fileWorkshop?.contents) {
        const validatedExample = this.convertFileWorkshopExample(example);
        if (example.isPositive) {
          positiveExamples.push(validatedExample);
        } else {
          negativeExamples.push(validatedExample);
        }
      }
    }
    
    // Build the rule
    const rule: ValidatedRule = {
      name: practice.name,
      positiveExamples,
      negativeExamples,
    };
    
    // Add detection program if valid
    if (includeDetection && practice.toolings?.program) {
      const language = this.areAllExamplesAvro(practice)
        ? ProgrammingLanguage.AVRO
        : practice.toolings.language;
      
      if (language === ProgrammingLanguage.GENERIC) {
        console.warn(`Warning: Tooling language is GENERIC for practice "${practice.name}"`);
      }
      
      rule.detectionProgram = {
        code: practice.toolings.program,
        description: practice.toolings.programDescription || '',
        language,
      };
    }
    
    return rule;
  }

  /**
   * Builds the standard description from all contained rules
   * Format:
   * ## {practice name}
   *    {practice description}
   * 
   * ## {practice name}
   *    {practice description}
   */
  buildStandardDescription(rules: ValidatedRule[], practices: ParsedPractice[]): string {
    const practiceMap = new Map<string, ParsedPractice>();
    for (const practice of practices) {
      practiceMap.set(practice.name, practice);
    }
    
    const descriptions: string[] = [];
    
    rules.forEach((rule) => {
      const practice = practiceMap.get(rule.name);
      const description = practice?.description || '';
      
      // Indent each line of the description
      const indentedDescription = description
        .split('\n')
        .map(line => `   ${line}`)
        .join('\n');
      
      descriptions.push(`## ${rule.name}\n${indentedDescription}`);
    });
    
    return descriptions.join('\n\n');
  }

  /**
   * Converts all practices to validated standards
   */
  convert(practices: ParsedPractice[]): ValidationOutput {
    // Load mappings
    this.loadSpacesMapping();
    this.loadStandardsMapping();
    
    // Group practices by standard
    const standardGroups = new Map<string, ParsedPractice[]>();
    const unmappedPractices: ParsedPractice[] = [];
    
    for (const practice of practices) {
      const standardName = this.getStandardForPractice(practice.name);
      if (standardName) {
        if (!standardGroups.has(standardName)) {
          standardGroups.set(standardName, []);
        }
        standardGroups.get(standardName)!.push(practice);
      } else {
        unmappedPractices.push(practice);
      }
    }
    
    // Warn about unmapped practices
    if (unmappedPractices.length > 0) {
      console.warn(`Warning: ${unmappedPractices.length} practice(s) not found in standards mapping:`);
      for (const practice of unmappedPractices) {
        console.warn(`  - "${practice.name}"`);
      }
    }
    
    // Build validated standards
    const validatedStandards: ValidatedStandard[] = [];
    
    // Determine the space name (assuming all practices are from the same space)
    // If practices are from different spaces, use the most common one
    const spaceNameCounts = new Map<string, number>();
    for (const practice of practices) {
      const spaceName = this.getSpaceName(practice.space);
      spaceNameCounts.set(spaceName, (spaceNameCounts.get(spaceName) ?? 0) + 1);
    }
    const primarySpaceName = [...spaceNameCounts.entries()]
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unknown Space';
    
    // Convert each standard group
    for (const standardMapping of this.standardsMapping) {
      const practicesInStandard = standardGroups.get(standardMapping.name);
      if (!practicesInStandard || practicesInStandard.length === 0) {
        continue; // Skip empty standards
      }
      
      // Convert practices to rules
      const rules: ValidatedRule[] = [];
      for (const practice of practicesInStandard) {
        rules.push(this.convertPracticeToRule(practice));
      }
      
      // Build standard description from rules
      const description = this.buildStandardDescription(rules, practicesInStandard);
      
      // Build prefixed standard name
      const prefixedName = `${primarySpaceName} - ${standardMapping.name}`;
      
      validatedStandards.push({
        name: prefixedName,
        description,
        rules,
      });
    }
    
    // Handle unmapped practices as a separate "Uncategorized" standard if any
    if (unmappedPractices.length > 0) {
      const rules: ValidatedRule[] = [];
      for (const practice of unmappedPractices) {
        rules.push(this.convertPracticeToRule(practice));
      }
      
      const description = this.buildStandardDescription(rules, unmappedPractices);
      
      validatedStandards.push({
        name: `${primarySpaceName} - Uncategorized`,
        description,
        rules,
      });
    }
    
    return {
      standards: validatedStandards,
    };
  }
}

