import { readFileSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';
import type { YamlOutput, YamlPractice, CodeExampleOutput } from './types.js';

/**
 * Represents a minified practice (without unit_test examples)
 */
export interface MinifiedPractice {
  name: string;
  description: string;
  categories: string[];
  positive_examples: CodeExampleOutput[];
  negative_examples: CodeExampleOutput[];
}

/**
 * Represents the minified YAML output
 */
export interface MinifiedYamlOutput {
  practices: MinifiedPractice[];
}

/**
 * Minifies practices.yaml by removing unit_test examples
 */
export class YamlMinifier {
  /**
   * Loads a YAML file and returns its parsed content
   */
  loadYaml(inputPath: string): YamlOutput {
    const fileContent = readFileSync(inputPath, 'utf-8');
    const parsed = yaml.load(fileContent) as YamlOutput;
    
    if (!parsed?.practices) {
      throw new Error('Invalid YAML structure: missing practices array');
    }
    
    return parsed;
  }

  /**
   * Filters out examples with source: 'unit_test'
   */
  private filterUnitTestExamples(examples: CodeExampleOutput[]): CodeExampleOutput[] {
    return examples.filter(example => example.source !== 'unit_test');
  }

  /**
   * Minifies a single practice by removing unit_test examples
   */
  private minifyPractice(practice: YamlPractice): MinifiedPractice {
    return {
      name: practice.name,
      description: practice.description,
      categories: practice.categories,
      positive_examples: this.filterUnitTestExamples(practice.positive_examples || []),
      negative_examples: this.filterUnitTestExamples(practice.negative_examples || []),
    };
  }

  /**
   * Minifies all practices by removing unit_test examples
   */
  minify(input: YamlOutput): MinifiedYamlOutput {
    const minifiedPractices = input.practices.map(practice => this.minifyPractice(practice));
    
    return {
      practices: minifiedPractices,
    };
  }

  /**
   * Writes the minified output to a YAML file
   */
  writeYaml(output: MinifiedYamlOutput, outputPath: string): void {
    const yamlContent = yaml.dump(output, {
      indent: 2,
      lineWidth: -1, // Disable line wrapping
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });
    
    writeFileSync(outputPath, yamlContent, 'utf-8');
  }

  /**
   * Loads, minifies, and writes the YAML file
   * @param inputPath - Path to the input practices.yaml file
   * @param outputPath - Path to write the minified output
   * @returns The minified content as a string
   */
  processFile(inputPath: string, outputPath: string): string {
    console.log(`Loading: ${inputPath}`);
    const input = this.loadYaml(inputPath);
    
    const originalCount = input.practices.length;
    let totalOriginalExamples = 0;
    let totalMinifiedExamples = 0;
    
    input.practices.forEach(p => {
      totalOriginalExamples += (p.positive_examples?.length || 0) + (p.negative_examples?.length || 0);
    });
    
    console.log(`Minifying ${originalCount} practices...`);
    const minified = this.minify(input);
    
    minified.practices.forEach(p => {
      totalMinifiedExamples += (p.positive_examples?.length || 0) + (p.negative_examples?.length || 0);
    });
    
    console.log(`Writing minified output to: ${outputPath}`);
    this.writeYaml(minified, outputPath);
    
    const removedExamples = totalOriginalExamples - totalMinifiedExamples;
    console.log(`Removed ${removedExamples} unit_test examples (${totalOriginalExamples} → ${totalMinifiedExamples})`);
    
    // Return the YAML content as string for use in the prompt
    return yaml.dump(minified, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      forceQuotes: false,
    });
  }
}

