import { writeFileSync } from 'fs';
import yaml from 'js-yaml';
import type {
  ParsedPractice,
  DetectionUnitTest,
  Example,
  FileContent,
  CodeExample,
  CodeExampleOutput,
  SeparatedExamples,
  YamlPractice,
  YamlOutput,
} from './types.js';

/**
 * Exports practices to YAML format with code examples
 */
export class YamlExporter {
  private readonly contextLines: number;

  constructor(contextLines = 2) {
    this.contextLines = contextLines;
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
  private extractCodeWithContext(example: Example): string {
    const contents = example.fileWorkshop.contents;
    const beginLine = example.position.begin.line;
    const endLine = example.position.end.line;

    // Calculate min and max line numbers from contents
    const minLine = Math.min(...contents.map((c) => c.line));
    const maxLine = Math.max(...contents.map((c) => c.line));

    // Add context lines, clamped to file bounds
    const startLine = Math.max(minLine, beginLine - this.contextLines);
    const stopLine = Math.min(maxLine, endLine + this.contextLines);

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
   * Converts a detection unit test to a CodeExample
   */
  private processUnitTest(test: DetectionUnitTest, language: string): CodeExample {
    return {
      source: 'unit_test',
      description: test.description || '',
      language,
      code: test.code,
      isPositive: test.isCompliant,
    };
  }

  /**
   * Converts a fileWorkshop example to a CodeExample
   */
  private processFileWorkshopExample(example: Example): CodeExample {
    return {
      source: 'file_workshop',
      description: example.description || '',
      language: example.fileWorkshop?.lang || 'unknown',
      filePath: example.fileWorkshop?.path,
      code: this.extractCodeWithContext(example),
      isPositive: example.isPositive,
    };
  }

  /**
   * Removes the isPositive field from a CodeExample for output
   */
  private toOutputFormat(example: CodeExample): CodeExampleOutput {
    const { isPositive: _isPositive, ...output } = example;
    return output;
  }

  /**
   * Separates examples into positive and negative arrays
   */
  private separateByCompliance(examples: CodeExample[]): SeparatedExamples {
    const positive: CodeExampleOutput[] = [];
    const negative: CodeExampleOutput[] = [];

    for (const example of examples) {
      const output = this.toOutputFormat(example);
      if (example.isPositive) {
        positive.push(output);
      } else {
        negative.push(output);
      }
    }

    return { positive, negative };
  }

  /**
   * Converts a parsed practice to YAML-ready format
   */
  private convertPractice(practice: ParsedPractice): YamlPractice {
    const inferredLanguage = this.inferLanguage(practice);
    const allExamples: CodeExample[] = [];

    // Warn if inferred language is unknown (affects unit tests)
    if (inferredLanguage === 'unknown' && (practice.detectionUnitTests?.length ?? 0) > 0) {
      console.warn(`Warning: Practice "${practice.name}" has unit tests but language could not be inferred (using "unknown")`);
    }

    // Process unit tests
    for (const test of practice.detectionUnitTests ?? []) {
      allExamples.push(this.processUnitTest(test, inferredLanguage));
    }

    // Process fileWorkshop examples
    for (const example of practice.examples) {
      if (example.fileWorkshop?.contents) {
        const processedExample = this.processFileWorkshopExample(example);
        
        // Warn if file workshop example has unknown language
        if (processedExample.language === 'unknown') {
          console.warn(`Warning: Practice "${practice.name}" has a file workshop example with unknown language (path: ${example.fileWorkshop?.path || 'no path'})`);
        }
        
        allExamples.push(processedExample);
      }
    }

    // Separate by compliance
    const { positive, negative } = this.separateByCompliance(allExamples);

    const result: YamlPractice = {
      name: practice.name,
      description: practice.description,
      categories: [...practice.categories].sort(),
      positive_examples: positive,
      negative_examples: negative,
    };

    // Add language from toolings if present
    if (practice.toolings?.language) {
      result.language = practice.toolings.language;
    }

    return result;
  }

  /**
   * Exports all practices to a YAML file
   */
  public export(practices: ParsedPractice[], outputPath: string): void {
    const yamlPractices = practices.map((p) => this.convertPractice(p));

    const output: YamlOutput = {
      practices: yamlPractices,
    };

    const yamlString = yaml.dump(output, {
      indent: 2,
      lineWidth: -1, // Don't wrap lines
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });

    writeFileSync(outputPath, yamlString, 'utf-8');
    console.log(`YAML exported to: ${outputPath}`);
    console.log(`Total practices: ${yamlPractices.length}`);
  }
}

