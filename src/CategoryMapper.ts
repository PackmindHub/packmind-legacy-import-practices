import { writeFileSync, existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
import { YamlMinifier } from './YamlMinifier.js';
import { createLLMService, type LLMServicePrompt } from './LLMService.js';

// ============================================================================
// Types
// ============================================================================

interface Standard {
  name: string;
  description: string;
  practices: string[];
}

interface StandardsMapping {
  standards: Standard[];
}

interface MinifiedPractice {
  name: string;
  description: string;
  categories: string[];
}

interface MinifiedYaml {
  practices: MinifiedPractice[];
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Counts the number of practices in the minified YAML content
 * Looks for lines containing "- name:" which indicate practice entries (with any leading whitespace)
 */
export function countPracticesInYaml(yamlContent: string): number {
  const practiceMatches = yamlContent.match(/^\s*- name:/gm);
  return practiceMatches ? practiceMatches.length : 0;
}

/**
 * Calculates the maximum number of categories based on practice count
 * Target: ~5 practices per standard (minimum), with bounds [2, 10]
 */
export function calculateMaxCategories(practiceCount: number): number {
  return Math.max(2, Math.min(10, Math.ceil(practiceCount / 5)));
}

/**
 * Builds the categorization prompt for the LLM
 */
export function buildCategorizationPrompt(yamlContent: string): string {
  const practiceCount = countPracticesInYaml(yamlContent);
  const maxCategories = calculateMaxCategories(practiceCount);
  
  return `You are an expert software engineer tasked with categorizing coding practices into meaningful categories.

## Task
Analyze the following coding practices and create a categorization scheme that groups them logically.

## Hard Constraints (MUST be followed)
- Create AT MOST ${maxCategories} standards (you have ${practiceCount} practices to categorize)
- Each standard MUST contain AT LEAST 3 practices - no single-practice or two-practice standards
- Prefer FEWER, BROADER standards over many narrow ones
- If in doubt, merge related practices into one standard
- **ABSOLUTE RULE: Each practice must appear in EXACTLY ONE standard - ZERO DUPLICATES**
- Standard names should be clear, concise, and descriptive

## Consolidation Principles (IMPORTANT)
- Group by BROAD THEMES (e.g., "Code Quality & Readability" not just "Naming Conventions")
- Merge related concepts: error handling + validation can share one standard
- Technology-specific practices (Kafka, Avro, Liquibase, Maven) can share a "Platform & Infrastructure" standard
- Language-specific idioms (Java Clock, specific APIs) can merge into "Code Quality" or a broader language standard
- Only create separate standards when practices are fundamentally different in nature (e.g., Testing vs Architecture)

## Anti-patterns to AVOID
- Creating "Avro Schema Design" and "Kafka Practices" as separate standards → merge into "Messaging & Schema Standards"
- Creating "Java Language Usage" for 1-2 practices → merge into broader "Code Quality" or "Clean Code"
- Creating narrow standards like "SOLID Principles" with only 1-2 practices → merge into "Design Principles" or "Architecture"
- One or two practices per standard is NEVER acceptable

## ⚠️ CRITICAL: Testing Category Priority (READ CAREFULLY)

**ALL practices containing ANY of these keywords MUST go EXCLUSIVELY in "Testing Best Practices":**
- "mock" (including "mocks", "mock data", "mock value", "mock files")
- "test" (including "tests", "unit test", "test data")

**CONCRETE EXAMPLES - follow these exactly:**
- "naming mock value" → Testing Best Practices ✅ (NOT Naming Conventions ❌)
- "Use distinct mock data for tests" → Testing Best Practices ✅ (NOT Clean Code ❌)
- "Use base mocks for variations" → Testing Best Practices ✅ (NOT Clean Code ❌)
- "Use mock files for test data in unit tests" → Testing Best Practices ✅

**WHY:** Mock-related practices are fundamentally about testing methodology. Even if they mention "naming" or improve "readability", their primary domain is testing.

## Secondary Priority Rules
When a practice could fit multiple categories (and is NOT testing-related):
1. **Consolidate first**: Always try to merge into an existing broader standard
2. **Domain-specific over generic**: Prefer specialized categories (e.g., "Compose Best Practices" over "Code Style")
3. **Primary intent**: Categorize by PRIMARY purpose, not secondary aspects

## ❌ FORBIDDEN - These mistakes will invalidate your output:
1. Placing the same practice in multiple standards
2. Placing any "mock" or "test" related practice outside "Testing Best Practices"
3. Missing any practice from the input
4. Creating more than ${maxCategories} standards
5. Creating any standard with fewer than 3 practices

## Output Format
Return ONLY valid YAML with this structure:

\`\`\`yaml
standards:
  - name: "Standard Name"
    description: "Brief description of what this standard covers"
    practices:
      - "Exact Practice Name 1"
      - "Exact Practice Name 2"
\`\`\`

## Final Verification (do this before outputting):
1. Count total practices in output - must equal ${practiceCount}
2. Count standards - must be AT MOST ${maxCategories}
3. Check each standard has AT LEAST 3 practices
4. Search for "mock" in your output - ALL must be in "Testing Best Practices"
5. Check no practice name appears twice across all standards

## Coding Practices to Categorize

${yamlContent}`;
}

/**
 * Parses the LLM response to extract the YAML content
 */
export function parseLLMResponse(response: string): string {
  // Try to extract YAML from code blocks
  const yamlBlockMatch = /```ya?ml\n([\s\S]*?)```/.exec(response);
  if (yamlBlockMatch?.[1]) {
    return yamlBlockMatch[1].trim();
  }
  
  // If no code block, assume the entire response is YAML
  return response.trim();
}

/**
 * Removes duplicate practices across categories, keeping only the first occurrence
 * Returns the cleaned data and a report of duplicates found
 */
export function deduplicatePractices(data: StandardsMapping): { data: StandardsMapping; duplicatesRemoved: number } {
  const seenPractices = new Set<string>();
  let duplicatesRemoved = 0;
  
  for (const category of data.standards) {
    if (category.practices && Array.isArray(category.practices)) {
      // First, deduplicate within the same category
      const uniqueInCategory = [...new Set(category.practices)];
      const inCategoryDupes = category.practices.length - uniqueInCategory.length;
      if (inCategoryDupes > 0) {
        console.log(`  ⚠️  Removed ${inCategoryDupes} duplicate(s) within "${category.name}"`);
        duplicatesRemoved += inCategoryDupes;
      }
      
      // Then, remove practices already seen in other categories
      const filteredPractices: string[] = [];
      for (const practice of uniqueInCategory) {
        const normalizedPractice = practice.toLowerCase().trim();
        if (seenPractices.has(normalizedPractice)) {
          console.log(`  ⚠️  Removed duplicate "${practice}" from "${category.name}" (already in another category)`);
          duplicatesRemoved++;
        } else {
          seenPractices.add(normalizedPractice);
          filteredPractices.push(practice);
        }
      }
      category.practices = filteredPractices;
    }
  }
  
  return { data, duplicatesRemoved };
}

// ============================================================================
// Post-Processing Helper Functions
// ============================================================================

/**
 * Extracts all practice names from the minified YAML file
 * Returns a Map of normalized name -> original name for case-insensitive comparison
 */
export function extractOriginalPracticeNames(minifiedYamlPath: string): Map<string, string> {
  const content = readFileSync(minifiedYamlPath, 'utf-8');
  const data = yaml.load(content) as MinifiedYaml;
  
  const practiceMap = new Map<string, string>();
  if (data && data.practices) {
    for (const practice of data.practices) {
      if (practice.name) {
        practiceMap.set(practice.name.toLowerCase().trim(), practice.name);
      }
    }
  }
  
  return practiceMap;
}

/**
 * Extracts practice descriptions from the minified YAML for use in retry prompts
 * Returns a Map of normalized name -> description
 */
export function extractPracticeDescriptions(minifiedYamlPath: string): Map<string, string> {
  const content = readFileSync(minifiedYamlPath, 'utf-8');
  const data = yaml.load(content) as MinifiedYaml;
  
  const descriptionMap = new Map<string, string>();
  if (data && data.practices) {
    for (const practice of data.practices) {
      if (practice.name && practice.description) {
        descriptionMap.set(practice.name.toLowerCase().trim(), practice.description);
      }
    }
  }
  
  return descriptionMap;
}

/**
 * Finds practices that are in the original set but missing from the mapped standards
 * Returns an array of original practice names (with original casing)
 */
export function findMissingPractices(
  originalPractices: Map<string, string>,
  mapping: StandardsMapping
): string[] {
  // Collect all practices from the mapping (normalized)
  const mappedPractices = new Set<string>();
  for (const category of mapping.standards) {
    if (category.practices && Array.isArray(category.practices)) {
      for (const practice of category.practices) {
        mappedPractices.add(practice.toLowerCase().trim());
      }
    }
  }
  
  // Find missing practices
  const missing: string[] = [];
  for (const [normalized, original] of originalPractices) {
    if (!mappedPractices.has(normalized)) {
      missing.push(original);
    }
  }
  
  return missing;
}

/**
 * Removes duplicate practices across categories, keeping one random standard per practice
 * Returns the cleaned data and a count of duplicates removed
 */
export function removeDuplicatesRandomly(data: StandardsMapping): { data: StandardsMapping; duplicatesRemoved: number } {
  // First, build a map of practice -> all categories it appears in
  const practiceLocations = new Map<string, Array<{ categoryIndex: number; practiceIndex: number; practiceName: string }>>();
  
  for (let catIdx = 0; catIdx < data.standards.length; catIdx++) {
    const category = data.standards[catIdx];
    if (category?.practices && Array.isArray(category.practices)) {
      for (let practiceIdx = 0; practiceIdx < category.practices.length; practiceIdx++) {
        const practice = category.practices[practiceIdx];
        if (practice) {
          const normalized = practice.toLowerCase().trim();
          
          if (!practiceLocations.has(normalized)) {
            practiceLocations.set(normalized, []);
          }
          practiceLocations.get(normalized)!.push({ 
            categoryIndex: catIdx, 
            practiceIndex: practiceIdx,
            practiceName: practice
          });
        }
      }
    }
  }
  
  // Find duplicates and randomly pick one to keep
  let duplicatesRemoved = 0;
  const indicesToRemove: Array<{ categoryIndex: number; practiceIndex: number }> = [];
  
  for (const [, locations] of practiceLocations) {
    if (locations.length > 1) {
      // Randomly pick one location to keep
      const keepIndex = Math.floor(Math.random() * locations.length);
      const keepLocation = locations[keepIndex]!;
      const keepCategoryData = data.standards[keepLocation.categoryIndex];
      const keepCategory = keepCategoryData ? keepCategoryData.name : 'Unknown';
      const firstLocation = locations[0]!;
      
      console.log(`  ⚠️  Duplicate "${firstLocation.practiceName}" found in ${locations.length} categories, keeping in "${keepCategory}"`);
      
      // Mark all other locations for removal
      for (let i = 0; i < locations.length; i++) {
        if (i !== keepIndex) {
          const loc = locations[i];
          if (loc) {
            indicesToRemove.push({ categoryIndex: loc.categoryIndex, practiceIndex: loc.practiceIndex });
            duplicatesRemoved++;
          }
        }
      }
    }
  }
  
  // Sort by categoryIndex desc, then practiceIndex desc to remove from end first
  indicesToRemove.sort((a, b) => {
    if (a.categoryIndex !== b.categoryIndex) {
      return b.categoryIndex - a.categoryIndex;
    }
    return b.practiceIndex - a.practiceIndex;
  });
  
  // Remove the practices
  for (const { categoryIndex, practiceIndex } of indicesToRemove) {
    const category = data.standards[categoryIndex];
    if (category?.practices) {
      category.practices.splice(practiceIndex, 1);
    }
  }
  
  return { data, duplicatesRemoved };
}

// ============================================================================
// Retry Prompt Building
// ============================================================================

/**
 * Builds a focused prompt for categorizing missing practices into existing standards
 * Only allows selecting from existing standards (no new categories)
 */
export function buildRetryPrompt(
  missingPractices: string[],
  existingStandards: Array<{ name: string; description: string }>,
  practiceDescriptions: Map<string, string>
): string {
  // Build the list of existing standards with descriptions
  const standardsList = existingStandards
    .map((s, i) => `${i + 1}. **${s.name}**: ${s.description}`)
    .join('\n');
  
  // Build the list of missing practices with descriptions
  const practicesList = missingPractices
    .map(name => {
      const description = practiceDescriptions.get(name.toLowerCase().trim()) || '';
      // Truncate description if too long
      const shortDesc = description.length > 200 
        ? description.substring(0, 200) + '...' 
        : description;
      return `- **${name}**: ${shortDesc}`;
    })
    .join('\n');
  
  return `You are an expert software engineer tasked with categorizing coding practices.

## Task
The following practices were not categorized in the initial pass. You MUST assign each one to ONE of the existing standards below.

## ⚠️ CRITICAL RULES
1. **DO NOT create new standards** - only use the standards listed below
2. Each practice MUST be assigned to exactly ONE standard
3. Use the exact practice name as provided (do not modify it)

## Existing Standards (you MUST pick from these)

${standardsList}

## Practices to Categorize

${practicesList}

## Output Format
Return ONLY valid YAML with this exact structure:

\`\`\`yaml
standards:
  - name: "Exact Standard Name From List Above"
    practices:
      - "Exact Practice Name 1"
  - name: "Another Standard Name"
    practices:
      - "Exact Practice Name 2"
\`\`\`

Note: Only include standards that have practices assigned to them. Do not include empty standards.`;
}

/**
 * Merges retry LLM results into the existing mapping
 * Practices from the retry response are added to their assigned standards
 */
export function mergeRetryResults(existing: StandardsMapping, retryResponse: string): StandardsMapping {
  const yamlContent = parseLLMResponse(retryResponse);
  
  let retryData: StandardsMapping;
  try {
    retryData = yaml.load(yamlContent) as StandardsMapping;
  } catch {
    console.log('  ⚠️  Failed to parse retry response, skipping merge');
    return existing;
  }
  
  if (!retryData?.standards) {
    console.log('  ⚠️  Invalid retry response structure, skipping merge');
    return existing;
  }
  
  // Build a map of existing standards by normalized name for fast lookup
  const existingByName = new Map<string, Standard>();
  for (const category of existing.standards) {
    existingByName.set(category.name.toLowerCase().trim(), category);
  }
  
  // Merge practices from retry response into existing standards
  let practicesAdded = 0;
  for (const retryCategory of retryData.standards) {
    const normalizedName = retryCategory.name.toLowerCase().trim();
    const existingCategory = existingByName.get(normalizedName);
    
    if (existingCategory && retryCategory.practices) {
      for (const practice of retryCategory.practices) {
        // Check if practice already exists (avoid duplicates)
        const normalizedPractice = practice.toLowerCase().trim();
        const alreadyExists = existingCategory.practices.some(
          p => p.toLowerCase().trim() === normalizedPractice
        );
        
        if (!alreadyExists) {
          existingCategory.practices.push(practice);
          practicesAdded++;
        }
      }
    } else if (!existingCategory) {
      console.log(`  ⚠️  Standard "${retryCategory.name}" from retry not found in existing mapping, skipping`);
    }
  }
  
  console.log(`  ✅ Merged ${practicesAdded} practice(s) from retry response`);
  return existing;
}

/**
 * Sorts practices alphabetically within each standard/category
 */
export function sortPracticesAlphabetically(yamlContent: string): string {
  const data = yaml.load(yamlContent) as StandardsMapping;
  
  if (!data?.standards) {
    return yamlContent;
  }
  
  // Step 1: Remove duplicates
  console.log('\nChecking for duplicates...');
  const { data: cleanedData, duplicatesRemoved } = deduplicatePractices(data);
  
  if (duplicatesRemoved > 0) {
    console.log(`\n✅ Removed ${duplicatesRemoved} duplicate practice(s) total`);
  } else {
    console.log('✅ No duplicates found');
  }
  
  // Step 2: Sort practices alphabetically within each category
  for (const category of cleanedData.standards) {
    if (category.practices && Array.isArray(category.practices)) {
      category.practices.sort((a, b) => 
        a.toLowerCase().localeCompare(b.toLowerCase())
      );
    }
  }
  
  // Count final totals
  const totalPractices = cleanedData.standards.reduce((sum, cat) => sum + cat.practices.length, 0);
  console.log(`\nFinal: ${cleanedData.standards.length} standards, ${totalPractices} unique practices`);
  
  // Serialize back to YAML with proper formatting
  return yaml.dump(cleanedData, {
    lineWidth: -1, // Don't wrap lines
    quotingType: '"',
    forceQuotes: false,
    noRefs: true,
  });
}

// ============================================================================
// Category Mapper
// ============================================================================

/**
 * Configuration for the CategoryMapper
 */
export interface CategoryMapperConfig {
  inputYamlPath: string;
  minifiedYamlPath: string;
  outputMappingPath: string;
}

/**
 * Handles the categorization of coding practices using an LLM
 */
export class CategoryMapper {
  private config: CategoryMapperConfig;
  private minifier: YamlMinifier;
  private llmService: LLMServicePrompt;

  constructor(config: CategoryMapperConfig, llmService?: LLMServicePrompt) {
    this.config = config;
    this.minifier = new YamlMinifier();
    this.llmService = llmService || createLLMService();
  }

  /**
   * Validates that required input files exist
   */
  private validateInputs(): void {
    if (!existsSync(this.config.inputYamlPath)) {
      throw new Error(`practices.yaml not found: ${this.config.inputYamlPath}\nUse --init <file.jsonl> to generate practices.yaml first.`);
    }
  }

  /**
   * Step 1: Generate minified YAML (removing unit_test examples)
   */
  private generateMinifiedYaml(): string {
    console.log('='.repeat(60));
    console.log('STEP 1: Generating minified YAML (removing unit_test examples)');
    console.log('='.repeat(60));
    
    const minifiedContent = this.minifier.processFile(
      this.config.inputYamlPath,
      this.config.minifiedYamlPath
    );
    
    console.log('');
    return minifiedContent;
  }

  /**
   * Step 2: Build the categorization prompt
   */
  private buildPrompt(minifiedContent: string): string {
    console.log('='.repeat(60));
    console.log('STEP 2: Building categorization prompt');
    console.log('='.repeat(60));
    
    const prompt = buildCategorizationPrompt(minifiedContent);
    console.log(`Prompt length: ${prompt.length} characters`);
    console.log('');
    
    return prompt;
  }

  /**
   * Step 3: Send prompt to LLM for categorization
   */
  private async categorizeWithLLM(prompt: string): Promise<string> {
    console.log('='.repeat(60));
    console.log('STEP 3: Sending to LLM for categorization');
    console.log('='.repeat(60));
    
    console.log(`Using model: ${this.llmService.getModel()}`);
    console.log('Waiting for LLM response...');
    
    return await this.llmService.executePrompt(prompt);
  }

  /**
   * Step 4: Parse LLM response into StandardsMapping
   */
  private parseResponse(response: string): StandardsMapping {
    const yamlContent = parseLLMResponse(response);
    const data = yaml.load(yamlContent) as StandardsMapping;
    
    if (!data?.standards) {
      throw new Error('Invalid LLM response: missing categories');
    }
    
    return data;
  }

  /**
   * Step 5: Post-process mapping (validate completeness, handle duplicates, retry if needed)
   */
  private async postProcessMapping(
    mapping: StandardsMapping,
    originalPractices: Map<string, string>,
    practiceDescriptions: Map<string, string>
  ): Promise<StandardsMapping> {
    console.log('='.repeat(60));
    console.log('STEP 4: Post-processing (validation & retry loop)');
    console.log('='.repeat(60));
    
    const MAX_RETRIES = 5;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`\n--- Validation attempt ${attempt}/${MAX_RETRIES} ---`);
      
      // Step 4a: Remove duplicates (randomly keeping one standard per practice)
      console.log('\nChecking for duplicates...');
      const { data: deduped, duplicatesRemoved } = removeDuplicatesRandomly(mapping);
      mapping = deduped;
      
      if (duplicatesRemoved > 0) {
        console.log(`  ✅ Removed ${duplicatesRemoved} duplicate(s)`);
      } else {
        console.log('  ✅ No duplicates found');
      }
      
      // Step 4b: Check for missing practices
      const missing = findMissingPractices(originalPractices, mapping);
      
      if (missing.length === 0) {
        console.log('  ✅ All practices are categorized!');
        break;
      }
      
      console.log(`  ⚠️  ${missing.length} practice(s) missing from mapping`);
      
      if (attempt < MAX_RETRIES) {
        // Retry with focused prompt for missing practices
        console.log(`\n  → Retrying with missing practices only...`);
        console.log(`  Missing practices:`);
        for (const practice of missing) {
          console.log(`    - "${practice}"`);
        }
        
        const existingStandards = mapping.standards.map(c => ({
          name: c.name,
          description: c.description
        }));
        
        const retryPrompt = buildRetryPrompt(missing, existingStandards, practiceDescriptions);
        console.log(`\n  Sending retry prompt to LLM...`);
        console.log(`  Using model: ${this.llmService.getModel()}`);
        console.log(`  Prompt length: ${retryPrompt.length} characters`);
        console.log(`  Waiting for LLM response...`);
        
        const retryResponse = await this.llmService.executePrompt(retryPrompt);
        console.log(`  LLM response received (${retryResponse.length} characters)`);
        
        // Merge retry results into existing mapping
        mapping = mergeRetryResults(mapping, retryResponse);
      }
    }
    
    // Final check for missing practices after all retries
    const finalMissing = findMissingPractices(originalPractices, mapping);
    
    if (finalMissing.length > 0) {
      console.log(`\n⚠️  After ${MAX_RETRIES} attempts, ${finalMissing.length} practice(s) still uncategorized`);
      console.log('  → Adding to "To Categorize" standard');
      
      mapping.standards.push({
        name: 'To Categorize',
        description: 'Practices that could not be automatically categorized after multiple attempts',
        practices: finalMissing
      });
    }
    
    return mapping;
  }

  /**
   * Step 6: Sort practices and write final mapping file
   */
  private writeFinalMapping(mapping: StandardsMapping): void {
    console.log('\n' + '='.repeat(60));
    console.log('STEP 5: Writing final standards mapping file');
    console.log('='.repeat(60));
    
    // Sort practices alphabetically within each category
    for (const category of mapping.standards) {
      if (category.practices && Array.isArray(category.practices)) {
        category.practices.sort((a, b) => 
          a.toLowerCase().localeCompare(b.toLowerCase())
        );
      }
    }
    
    // Count final totals
    const totalPractices = mapping.standards.reduce((sum, cat) => sum + cat.practices.length, 0);
    console.log(`\nFinal: ${mapping.standards.length} standards, ${totalPractices} unique practices`);
    
    // Serialize to YAML
    const yamlContent = yaml.dump(mapping, {
      lineWidth: -1,
      quotingType: '"',
      forceQuotes: false,
      noRefs: true,
    });
    
    writeFileSync(this.config.outputMappingPath, yamlContent, 'utf-8');
    
    console.log('Practices sorted alphabetically within each standard');
    console.log(`Standards mapping written to: ${this.config.outputMappingPath}`);
    console.log('');
    console.log('Done!');
  }

  /**
   * Runs the full categorization workflow with post-processing
   */
  async run(): Promise<void> {
    this.validateInputs();
    
    // Step 1: Generate minified YAML
    const minifiedContent = this.generateMinifiedYaml();
    
    // Extract original practice names and descriptions for validation
    const originalPractices = extractOriginalPracticeNames(this.config.minifiedYamlPath);
    const practiceDescriptions = extractPracticeDescriptions(this.config.minifiedYamlPath);
    console.log(`Found ${originalPractices.size} practices to categorize\n`);
    
    // Step 2: Build prompt
    const prompt = this.buildPrompt(minifiedContent);
    
    // Step 3: Get initial categorization from LLM
    const response = await this.categorizeWithLLM(prompt);
    
    // Parse LLM response
    let mapping = this.parseResponse(response);
    
    // Step 4: Post-process (validate, retry, fallback)
    mapping = await this.postProcessMapping(mapping, originalPractices, practiceDescriptions);
    
    // Step 5: Write final mapping
    this.writeFinalMapping(mapping);
  }
}

