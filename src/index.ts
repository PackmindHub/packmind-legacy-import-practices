import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, basename } from 'path';
import { config } from 'dotenv';
import type { ParsedPractice, DetectionUnitTest, Example, Guidelines, Toolings } from './types.js';
import { displayPracticeStats, displayPracticeList, displayCategoryStats } from './OutputAnalysis.js';
import { YamlExporter } from './YamlExporter.js';
import { YamlMinifier } from './YamlMinifier.js';
import { CategoryMapper } from './CategoryMapper.js';
import { PackmindAPI } from './PackmindAPI.js';
import { PracticeToStandardConvertor } from './PracticeToStandardConvertor.js';
import { stringToProgrammingLanguage } from './ProgrammingLanguage.js';

// Load environment variables from .env file
config();

// ============================================================================
// Space Utilities
// ============================================================================

interface Space {
  _id: string;
  name: string;
}

/**
 * Converts a space name to a URL-friendly slug
 * e.g., "BforBank-Backend" -> "bforbank-backend"
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')     // Replace spaces with hyphens
    .replace(/[^a-z0-9-]/g, '-') // Replace non-alphanumeric chars with hyphens
    .replace(/-+/g, '-')      // Collapse multiple hyphens
    .replace(/^-|-$/g, '');   // Remove leading/trailing hyphens
}

/**
 * Loads the spaces.json file and returns a Map of space ID -> space name
 */
function loadSpacesMapping(spacesJsonPath: string): Map<string, string> {
  if (!existsSync(spacesJsonPath)) {
    throw new Error(`Spaces file not found: ${spacesJsonPath}\nUse --get-spaces to fetch spaces from Packmind API first.`);
  }
  
  const content = readFileSync(spacesJsonPath, 'utf-8');
  const spaces: Space[] = JSON.parse(content);
  
  const mapping = new Map<string, string>();
  for (const space of spaces) {
    mapping.set(space._id, space.name);
  }
  
  return mapping;
}

/**
 * Discovers all .jsonl files in a directory
 */
function discoverJsonlFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  
  const files = readdirSync(directory);
  return files
    .filter(file => file.endsWith('.jsonl'))
    .map(file => join(directory, file))
    .sort();
}

/**
 * Discovers all .minified.yaml files in a directory
 */
function discoverMinifiedYamlFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  
  const files = readdirSync(directory);
  return files
    .filter(file => file.endsWith('.minified.yaml'))
    .map(file => join(directory, file))
    .sort();
}

/**
 * Discovers all .standards-mapping.yaml files in a directory
 */
function discoverStandardsMappingFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  
  const files = readdirSync(directory);
  return files
    .filter(file => file.endsWith('.standards-mapping.yaml'))
    .map(file => join(directory, file))
    .sort();
}

/**
 * Extracts the space slug from a standards-mapping.yaml filename
 * e.g., "bforbank-android.standards-mapping.yaml" -> "bforbank-android"
 */
function extractSlugFromStandardsMappingFilename(filename: string): string | null {
  const match = filename.match(/^(.+)\.standards-mapping\.yaml$/);
  return match ? match[1] ?? null : null;
}

/**
 * Extracts the space ID from practices (assumes all practices in a file belong to the same space)
 */
function extractSpaceIdFromPractices(practices: ParsedPractice[]): string | null {
  if (practices.length === 0) {
    return null;
  }
  return practices[0]?.space ?? null;
}

/**
 * Builds a reverse lookup from slug to space ID
 * e.g., "bforbank-backend" -> "668bb6e13b9a4106512f38e2"
 */
function buildSlugToSpaceIdMap(spacesMapping: Map<string, string>): Map<string, string> {
  const slugToSpaceId = new Map<string, string>();
  for (const [spaceId, spaceName] of spacesMapping) {
    const slug = slugify(spaceName);
    slugToSpaceId.set(slug, spaceId);
  }
  return slugToSpaceId;
}

// ============================================================================
// CLI Arguments Parsing
// ============================================================================

interface CliArgs {
  command: 'init' | 'stats' | 'map' | 'get-spaces' | 'validate';
  inputFile?: string;
  outputFile?: string;
}

/**
 * Displays usage information
 */
function showUsage(): void {
  console.log(`
Usage: packmind-legacy-import [command] [options]

Commands:
  --map                                Run full pipeline: get-spaces → init → map (recommended)
  --get-spaces                         Fetch available spaces from Packmind API (manual/debug)
  --init                               Process all .jsonl files in res/ (manual/debug)
  --init <input.jsonl> [output.yaml]   Convert single JSONL file to YAML format
  --stats                              Display practice statistics (default)
  --validate                           Generate validation JSON with standards, rules, and examples
  --help                               Show this help message

Workflow:
  1. Place .jsonl files (one per space) in the res/ folder
  2. Run --map to execute the full pipeline:
     - Fetches spaces.json from Packmind API
     - Processes .jsonl files into {space-slug}.yaml + {space-slug}.minified.yaml
     - Generates {space-slug}.standards-mapping.yaml for each space using LLM

  Note: --get-spaces and --init are available for manual control/debugging.

Environment Variables:
  SOURCE_PACKMIND_API_KEY              Required for --map/--get-spaces: Your Packmind API key
  OPENAI_API_KEY                       Required for --map: Your OpenAI API key
  OPENAI_MODEL                         Optional for --map: Model to use (default: gpt-5.1-mini)

Examples:
  npx packmind-legacy-import --map                    # Run full pipeline (recommended)
  npx packmind-legacy-import --get-spaces             # Fetch spaces only (debug)
  npx packmind-legacy-import --init                   # Process .jsonl files only (debug)
  npx packmind-legacy-import --init file.jsonl        # Process single file
  npx packmind-legacy-import --stats
  npx packmind-legacy-import --validate
`);
}

/**
 * Parses command line arguments
 */
function parseArgs(args: string[]): CliArgs {
  const relevantArgs = args.slice(2); // Skip node and script path

  if (relevantArgs.includes('--help') || relevantArgs.includes('-h')) {
    showUsage();
    process.exit(0);
  }

  if (relevantArgs.includes('--init')) {
    const initIndex = relevantArgs.indexOf('--init');
    const inputFile = relevantArgs[initIndex + 1];
    const outputFile = relevantArgs[initIndex + 2];

    // If no input file or next arg is another flag, use multi-file mode
    if (!inputFile || inputFile.startsWith('--')) {
      return {
        command: 'init',
        // No inputFile means process all .jsonl files in res/
      };
    }

    return {
      command: 'init',
      inputFile,
      outputFile,
    };
  }

  if (relevantArgs.includes('--map')) {
    return { command: 'map' };
  }

  if (relevantArgs.includes('--get-spaces')) {
    return { command: 'get-spaces' };
  }

  if (relevantArgs.includes('--validate')) {
    return { command: 'validate' };
  }

  // Default command is stats
  return { command: 'stats' };
}

// ============================================================================
// Practice Parsing
// ============================================================================

/**
 * Parses a practice JSON string and extracts the required properties:
 * - name
 * - description
 * - categories
 * - examples
 * - suggestionsDisabled (optional)
 * - detectionUnitTests (optional)
 * - guidelines (optional)
 * - toolings (optional)
 * 
 * @param jsonString - The JSON string representing a practice object
 * @returns ParsedPractice object with the extracted properties
 * @throws Error if the JSON is invalid or required properties are missing
 */
export function parsePractice(jsonString: string): ParsedPractice {
  try {
    const parsed = JSON.parse(jsonString);
    
    // Validate that required properties exist
    if (!parsed.name) {
      throw new Error('Missing required property: name');
    }
    if (!parsed.description) {
      throw new Error('Missing required property: description');
    }
    if (!parsed.categories) {
      throw new Error('Missing required property: categories');
    }
    if (!parsed.examples) {
      throw new Error('Missing required property: examples');
    }
    if (!parsed.space) {
      throw new Error('Missing required property: space');
    }
    
    // Extract and return the properties (guidelines, toolings, and suggestionsDisabled are optional)
    const result: ParsedPractice = {
      name: parsed.name,
      description: parsed.description,
      categories: parsed.categories as string[],
      examples: parsed.examples as Example[],
      space: parsed.space as string,
    };
    
    // Add optional properties only if present
    if (parsed.suggestionsDisabled !== undefined) {
      result.suggestionsDisabled = parsed.suggestionsDisabled as boolean;
    }
    if (parsed.detectionUnitTests) {
      result.detectionUnitTests = parsed.detectionUnitTests as DetectionUnitTest[];
    }
    if (parsed.guidelines) {
      result.guidelines = parsed.guidelines as Guidelines;
    }
    if (parsed.toolings) {
      // Validate that toolings.language is present and valid
      if (!parsed.toolings.language) {
        throw new Error(`Practice "${parsed.name}" has toolings but missing required property: toolings.language`);
      }
      // Validate that the language matches a known ProgrammingLanguage enum value
      try {
        stringToProgrammingLanguage(parsed.toolings.language);
      } catch {
        throw new Error(`Practice "${parsed.name}" has invalid toolings.language: "${parsed.toolings.language}". Must be a valid ProgrammingLanguage.`);
      }
      result.toolings = parsed.toolings as Toolings;
    }
    
    return result;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON string: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Reads and parses a JSONL file into an array of practices
 */
function loadPracticesFromFile(filePath: string): ParsedPractice[] {
  const fileContent = readFileSync(filePath, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
  
  const practices: ParsedPractice[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    
    try {
      const practice = parsePractice(line);
      practices.push(practice);
    } catch (error) {
      console.error(`Error parsing practice at line ${i + 1}:`, error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
  
  return practices;
}

// ============================================================================
// Commands
// ============================================================================

/**
 * Converts a single JSONL file to YAML format (legacy single-file mode)
 */
function runSingleFileInit(inputFile: string, outputFile?: string): void {
  const resolvedInput = resolve(inputFile);
  
  if (!existsSync(resolvedInput)) {
    console.error(`Error: Input file not found: ${resolvedInput}`);
    process.exit(1);
  }
  
  // Default output file: same name with .yaml extension
  const resolvedOutput = outputFile 
    ? resolve(outputFile) 
    : resolvedInput.replace(/\.jsonl?$/, '.yaml');
  
  console.log(`Converting: ${resolvedInput}`);
  console.log(`Output:     ${resolvedOutput}`);
  console.log('');
  
  const practices = loadPracticesFromFile(resolvedInput);
  
  const exporter = new YamlExporter(2); // 2 lines of context
  exporter.export(practices, resolvedOutput);
}

/**
 * Processes all .jsonl files in res/ directory, creating space-prefixed outputs
 * @throws Error if spaces.json is missing or no .jsonl files are found
 */
function runMultiFileInit(): void {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const resDir = join(__dirname, '..', 'res');
  const spacesJsonPath = join(resDir, 'spaces.json');
  
  // Load spaces mapping (throws if file not found)
  const spacesMapping = loadSpacesMapping(spacesJsonPath);
  
  // Discover all .jsonl files
  const jsonlFiles = discoverJsonlFiles(resDir);
  
  if (jsonlFiles.length === 0) {
    throw new Error('No .jsonl files found in res/ directory. Place your .jsonl files in the res/ folder and try again.');
  }
  
  console.log('='.repeat(60));
  console.log('Multi-Space Init: Processing all .jsonl files');
  console.log('='.repeat(60));
  console.log(`Found ${jsonlFiles.length} .jsonl file(s) in res/`);
  console.log('');
  
  const exporter = new YamlExporter(2);
  const minifier = new YamlMinifier();
  let processedCount = 0;
  
  for (const jsonlPath of jsonlFiles) {
    const fileName = basename(jsonlPath);
    console.log('-'.repeat(60));
    console.log(`Processing: ${fileName}`);
    console.log('-'.repeat(60));
    
    // Load practices
    const practices = loadPracticesFromFile(jsonlPath);
    
    if (practices.length === 0) {
      console.log(`  ⚠️  Skipping: No practices found in ${fileName}`);
      console.log('');
      continue;
    }
    
    // Extract space ID and get space name
    const spaceId = extractSpaceIdFromPractices(practices);
    
    if (!spaceId) {
      console.log(`  ⚠️  Skipping: No space ID found in ${fileName}`);
      console.log('');
      continue;
    }
    
    const spaceName = spacesMapping.get(spaceId);
    
    if (!spaceName) {
      console.log(`  ⚠️  Skipping: Unknown space ID "${spaceId}" in ${fileName}`);
      console.log(`      Make sure spaces.json contains this space ID.`);
      console.log('');
      continue;
    }
    
    // Generate slugged prefix
    const slug = slugify(spaceName);
    
    console.log(`  Space: ${spaceName}`);
    console.log(`  Slug:  ${slug}`);
    console.log(`  Practices: ${practices.length}`);
    
    // Generate output paths
    const yamlPath = join(resDir, `${slug}.yaml`);
    const minifiedPath = join(resDir, `${slug}.minified.yaml`);
    
    // Export to YAML
    console.log(`  → Exporting to ${slug}.yaml`);
    exporter.export(practices, yamlPath);
    
    // Create minified version
    console.log(`  → Creating ${slug}.minified.yaml`);
    minifier.processFile(yamlPath, minifiedPath);
    
    processedCount++;
    console.log('');
  }
  
  console.log('='.repeat(60));
  console.log(`Done! Processed ${processedCount} space(s).`);
  console.log('='.repeat(60));
}

/**
 * Converts JSONL file(s) to YAML format
 * - If inputFile is provided: single-file mode (legacy behavior)
 * - If no inputFile: multi-file mode (process all .jsonl in res/)
 */
function runInitCommand(inputFile?: string, outputFile?: string): void {
  if (inputFile) {
    runSingleFileInit(inputFile, outputFile);
  } else {
    runMultiFileInit();
  }
}

/**
 * Displays statistics about practices
 */
function runStatsCommand(): void {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const jsonlPath = join(__dirname, '..', 'res', 'practices.jsonl');
  
  if (!existsSync(jsonlPath)) {
    console.error(`Error: Default practices file not found: ${jsonlPath}`);
    console.error('Use --init <file.jsonl> to convert a JSONL file first.');
    process.exit(1);
  }
  
  const practices = loadPracticesFromFile(jsonlPath);
  
  displayPracticeStats(practices);
  displayCategoryStats(practices);
  displayPracticeList(practices);
}

/**
 * Extracts the space slug prefix from a minified.yaml filename
 * e.g., "bforbank-backend.minified.yaml" -> "bforbank-backend"
 */
function extractSlugFromMinifiedFilename(filename: string): string | null {
  const match = filename.match(/^(.+)\.minified\.yaml$/);
  return match ? match[1] ?? null : null;
}

/**
 * Runs only the LLM mapping step (Step 3 of the pipeline)
 * Processes all .minified.yaml files in res/ directory
 */
async function runLLMMappingStep(): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const resDir = join(__dirname, '..', 'res');
  
  // Discover all .minified.yaml files
  const minifiedFiles = discoverMinifiedYamlFiles(resDir);
  
  if (minifiedFiles.length === 0) {
    throw new Error('No .minified.yaml files found in res/ directory.');
  }
  
  console.log('='.repeat(60));
  console.log('Step 3: Generating standards mapping using LLM');
  console.log('='.repeat(60));
  console.log(`Found ${minifiedFiles.length} .minified.yaml file(s) in res/`);
  console.log('');
  
  let processedCount = 0;
  let errorCount = 0;
  
  for (const minifiedPath of minifiedFiles) {
    const fileName = basename(minifiedPath);
    const slug = extractSlugFromMinifiedFilename(fileName);
    
    if (!slug) {
      console.log(`⚠️  Skipping: Could not extract slug from ${fileName}`);
      continue;
    }
    
    console.log('='.repeat(60));
    console.log(`Processing: ${fileName}`);
    console.log(`Space slug: ${slug}`);
    console.log('='.repeat(60));
    console.log('');
    
    // Generate output paths based on slug
    const yamlPath = join(resDir, `${slug}.yaml`);
    const outputMappingPath = join(resDir, `${slug}.standards-mapping.yaml`);
    
    // Check that the corresponding .yaml file exists
    if (!existsSync(yamlPath)) {
      console.log(`⚠️  Skipping: ${slug}.yaml not found (required for mapping)`);
      console.log('');
      continue;
    }
    
    const mapper = new CategoryMapper({
      inputYamlPath: yamlPath,
      minifiedYamlPath: minifiedPath,
      outputMappingPath: outputMappingPath,
    });
    
    try {
      await mapper.run();
      processedCount++;
    } catch (error) {
      console.error(`Error processing ${fileName}:`, error instanceof Error ? error.message : String(error));
      errorCount++;
    }
    
    console.log('');
  }
  
  console.log('='.repeat(60));
  console.log('Mapping Summary');
  console.log('='.repeat(60));
  console.log(`Processed: ${processedCount} space(s)`);
  if (errorCount > 0) {
    console.log(`Errors: ${errorCount}`);
  }
}

/**
 * Runs the full mapping pipeline:
 * 1. Fetch spaces from Packmind API (--get-spaces)
 * 2. Process .jsonl files into YAML (--init)
 * 3. Generate standards mapping using LLM
 */
async function runMapCommand(): Promise<void> {
  console.log('');
  console.log('='.repeat(60));
  console.log('Full Pipeline: get-spaces → init → map');
  console.log('='.repeat(60));
  console.log('');
  
  // Step 1: Fetch spaces from Packmind API
  console.log('='.repeat(60));
  console.log('Step 1: Fetching spaces from Packmind API');
  console.log('='.repeat(60));
  await runGetSpacesCommand();
  console.log('');
  
  // Step 2: Process .jsonl files into YAML
  console.log('='.repeat(60));
  console.log('Step 2: Processing .jsonl files');
  console.log('='.repeat(60));
  runMultiFileInit();
  console.log('');
  
  // Step 3: Generate standards mapping using LLM
  await runLLMMappingStep();
  
  console.log('');
  console.log('='.repeat(60));
  console.log('Pipeline Complete!');
  console.log('='.repeat(60));
}

/**
 * Runs the get-spaces command to fetch available spaces from Packmind API
 * @throws Error if API key is missing or API call fails
 */
async function runGetSpacesCommand(): Promise<void> {
  const apiKey = process.env['SOURCE_PACKMIND_API_KEY'];
  
  if (!apiKey) {
    throw new Error('SOURCE_PACKMIND_API_KEY environment variable is not set. Please set it in your .env file or environment.');
  }
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const outputPath = join(__dirname, '..', 'res', 'spaces.json');
  
  console.log('Fetching spaces from Packmind API...');
  
  const api = new PackmindAPI(apiKey);
  const spaces = await api.getSpaces();
  
  writeFileSync(outputPath, JSON.stringify(spaces, null, 2), 'utf-8');
  
  console.log(`Successfully fetched ${spaces.length} space(s).`);
  console.log(`Output written to: ${outputPath}`);
}

/**
 * Runs the validate command to generate validation JSON with standards, rules, and examples
 * Processes all .standards-mapping.yaml files found in res/ directory
 * Loads all .jsonl files and matches practices by name and space ID
 */
function runValidateCommand(): void {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const resDir = join(__dirname, '..', 'res');
  
  const spacesPath = join(resDir, 'spaces.json');
  
  // Validate spaces.json exists
  if (!existsSync(spacesPath)) {
    console.error(`Error: Spaces file not found: ${spacesPath}`);
    console.error('Use --get-spaces to fetch spaces from Packmind API first.');
    process.exit(1);
  }
  
  // Load spaces mapping and build reverse lookup (slug -> spaceId)
  const spacesMapping = loadSpacesMapping(spacesPath);
  const slugToSpaceId = buildSlugToSpaceIdMap(spacesMapping);
  
  // Discover all .jsonl files and load all practices
  const jsonlFiles = discoverJsonlFiles(resDir);
  
  if (jsonlFiles.length === 0) {
    console.error(`Error: No .jsonl files found in: ${resDir}`);
    console.error('Place your practices .jsonl files in the res/ folder.');
    process.exit(1);
  }
  
  console.log('='.repeat(60));
  console.log('Generating Validation JSON');
  console.log('='.repeat(60));
  console.log(`Found ${jsonlFiles.length} .jsonl file(s)`);
  
  // Load all practices from all .jsonl files
  const allPractices: ParsedPractice[] = [];
  for (const jsonlPath of jsonlFiles) {
    const practices = loadPracticesFromFile(jsonlPath);
    allPractices.push(...practices);
    console.log(`  Loaded ${practices.length} practice(s) from ${basename(jsonlPath)}`);
  }
  console.log(`Total practices loaded: ${allPractices.length}`);
  console.log('');
  
  // Discover all .standards-mapping.yaml files
  const mappingFiles = discoverStandardsMappingFiles(resDir);
  
  if (mappingFiles.length === 0) {
    console.error(`Error: No .standards-mapping.yaml files found in: ${resDir}`);
    console.error('Use --map to generate standards mapping using LLM first.');
    process.exit(1);
  }
  
  console.log(`Found ${mappingFiles.length} standards mapping file(s)`);
  console.log('');
  
  let processedCount = 0;
  
  for (const mappingPath of mappingFiles) {
    const fileName = basename(mappingPath);
    const slug = extractSlugFromStandardsMappingFilename(fileName);
    
    if (!slug) {
      console.log(`⚠️  Skipping: Could not extract slug from ${fileName}`);
      continue;
    }
    
    // Get the space ID for this slug
    const spaceId = slugToSpaceId.get(slug);
    
    if (!spaceId) {
      console.log(`⚠️  Skipping ${slug}: No matching space found in spaces.json`);
      console.log(`   Available slugs: ${[...slugToSpaceId.keys()].join(', ')}`);
      continue;
    }
    
    // Filter practices belonging to this space
    const spacePractices = allPractices.filter(p => p.space === spaceId);
    
    if (spacePractices.length === 0) {
      console.log(`⚠️  Skipping ${slug}: No practices found for space ID ${spaceId}`);
      continue;
    }
    
    const outputPath = join(resDir, `${slug}.standards-validation.json`);
    
    console.log('-'.repeat(60));
    console.log(`Processing: ${slug}`);
    console.log('-'.repeat(60));
    console.log(`  Mapping: ${fileName}`);
    console.log(`  Space ID: ${spaceId}`);
    console.log(`  Practices found: ${spacePractices.length}`);
    
    // Create convertor and run conversion
    const convertor = new PracticeToStandardConvertor({
      spacesJsonPath: spacesPath,
      standardsMappingPath: mappingPath,
      contextLines: 2,
    });
    
    console.log('  Converting practices to standards...');
    const output = convertor.convert(spacePractices);
    
    // Write output
    writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    
    // Calculate stats for this space
    let totalRules = 0;
    let totalPositiveExamples = 0;
    let totalNegativeExamples = 0;
    let rulesWithDetection = 0;
    
    for (const standard of output.standards) {
      totalRules += standard.rules.length;
      for (const rule of standard.rules) {
        totalPositiveExamples += rule.positiveExamples.length;
        totalNegativeExamples += rule.negativeExamples.length;
        if (rule.detectionProgram) {
          rulesWithDetection++;
        }
      }
    }
    
    console.log(`  Standards: ${output.standards.length}`);
    console.log(`  Rules: ${totalRules}`);
    console.log(`  Rules with detection: ${rulesWithDetection}`);
    console.log(`  Positive examples: ${totalPositiveExamples}`);
    console.log(`  Negative examples: ${totalNegativeExamples}`);
    console.log(`  → Output: ${basename(outputPath)}`);
    console.log('');
    
    processedCount++;
  }
  
  console.log('='.repeat(60));
  console.log(`Done! Processed ${processedCount} space(s).`);
  console.log('='.repeat(60));
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Main entry point - parses CLI arguments and runs the appropriate command
 */
async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv);
    
    switch (args.command) {
      case 'init':
        runInitCommand(args.inputFile, args.outputFile);
        break;
      case 'stats':
        runStatsCommand();
        break;
      case 'map':
        await runMapCommand();
        break;
      case 'get-spaces':
        await runGetSpacesCommand();
        break;
      case 'validate':
        runValidateCommand();
        break;
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Execute main function if this module is run directly
main().catch((error) => {
  console.error('Unhandled error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});

// Export all types for external use
export * from './types.js';

