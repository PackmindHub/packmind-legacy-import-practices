import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, basename } from 'path';
import { createInterface } from 'readline';
import type { ParsedPractice, DetectionUnitTest, Example, Guidelines, Toolings } from './types.js';
import { displayPracticeStats, displayPracticeList, displayCategoryStats } from './OutputAnalysis.js';
import { YamlExporter } from './YamlExporter.js';
import { YamlMinifier } from './YamlMinifier.js';
import { CategoryMapper } from './CategoryMapper.js';
import { PackmindAPI } from './PackmindAPI.js';
import { PracticeToStandardConvertor } from './PracticeToStandardConvertor.js';
import { stringToProgrammingLanguage } from './ProgrammingLanguage.js';
import { PackmindV3Connector } from './PackmindV3Connector.js';
import type { ValidationOutput } from './types.js';

// Bun automatically loads .env files

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
 * Discovers all .standards-validation.json files in a directory
 */
function discoverValidationFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  
  const files = readdirSync(directory);
  return files
    .filter(file => file.endsWith('.standards-validation.json'))
    .map(file => join(directory, file))
    .sort();
}

/**
 * Stats for a validation file
 */
interface ValidationFileStats {
  path: string;
  filename: string;
  standardsCount: number;
  rulesCount: number;
}

/**
 * Extracts stats from a validation JSON file
 */
function getValidationFileStats(filePath: string): ValidationFileStats {
  const content = JSON.parse(readFileSync(filePath, 'utf-8')) as ValidationOutput;
  let rulesCount = 0;
  for (const standard of content.standards) {
    rulesCount += standard.rules?.length || 0;
  }
  return {
    path: filePath,
    filename: basename(filePath),
    standardsCount: content.standards.length,
    rulesCount,
  };
}

/**
 * Prompts user for input via readline
 */
function promptUser(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Parses user selection input into array of indices
 * Accepts: empty string (all), "all", or comma-separated numbers like "1,3,5"
 * @returns Array of 0-based indices, or null for "all"
 */
function parseSelectionInput(input: string, maxIndex: number): number[] | null {
  const trimmed = input.trim().toLowerCase();
  
  // Empty input or "all" means select all
  if (trimmed === '' || trimmed === 'all') {
    return null; // null means "all"
  }
  
  // Parse comma-separated numbers
  const parts = trimmed.split(',').map(s => s.trim()).filter(s => s.length > 0);
  const indices: number[] = [];
  
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 1 || num > maxIndex) {
      throw new Error(`Invalid selection: "${part}". Please enter numbers between 1 and ${maxIndex}.`);
    }
    indices.push(num - 1); // Convert to 0-based index
  }
  
  if (indices.length === 0) {
    throw new Error('No valid selections provided.');
  }
  
  // Remove duplicates and sort
  return [...new Set(indices)].sort((a, b) => a - b);
}

/**
 * Displays validation files with stats and prompts user for selection
 * @returns Array of selected file stats
 */
async function promptFileSelection(allStats: ValidationFileStats[]): Promise<ValidationFileStats[]> {
  console.log('');
  console.log('='.repeat(60));
  console.log(`Discovered ${allStats.length} validation file(s) in res/:`);
  console.log('='.repeat(60));
  console.log('');
  
  // Display numbered list with stats
  for (let i = 0; i < allStats.length; i++) {
    const stats = allStats[i];
    if (!stats) continue;
    console.log(`  [${i + 1}] ${stats.filename}`);
    console.log(`      Standards: ${stats.standardsCount} | Rules: ${stats.rulesCount}`);
    console.log('');
  }
  
  // Prompt for selection
  const selectionInput = await promptUser('Select files to import (enter numbers like "1,3" or press Enter for all): ');
  
  let selectedStats: ValidationFileStats[];
  let selectionDescription: string;
  
  try {
    const indices = parseSelectionInput(selectionInput, allStats.length);
    
    if (indices === null) {
      // All selected
      selectedStats = allStats;
      selectionDescription = 'ALL';
    } else {
      selectedStats = indices.map(i => allStats[i]).filter((s): s is ValidationFileStats => s !== undefined);
      selectionDescription = indices.map(i => i + 1).join(', ');
    }
  } catch (error) {
    throw error;
  }
  
  // Calculate totals for selected files
  let totalStandards = 0;
  let totalRules = 0;
  for (const stats of selectedStats) {
    totalStandards += stats.standardsCount;
    totalRules += stats.rulesCount;
  }
  
  console.log('');
  console.log(`Selected: ${selectionDescription} (${selectedStats.length} file(s), ${totalStandards} standards, ${totalRules} rules total)`);
  
  // Confirm selection
  const confirm = await promptUser('Proceed with import? (y/n): ');
  
  if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
    throw new Error('Import cancelled by user.');
  }
  
  return selectedStats;
}

/**
 * Extracts the space slug from a standards-mapping.yaml filename
 * e.g., "bforbank-android.standards-mapping.yaml" -> "bforbank-android"
 */
function extractSlugFromStandardsMappingFilename(filename: string): string | null {
  const match = /^(.+)\.standards-mapping\.yaml$/.exec(filename);
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
  command: 'init' | 'stats' | 'map' | 'get-spaces' | 'import';
  inputFile?: string;
  outputFile?: string;
  importOne?: boolean;
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
  --import                             Import .standards-validation.json files to Packmind V3
  --import --one                       Import only the first standard from each file
  --help                               Show this help message

Workflow:
  1. Place .jsonl files (one per space) in the res/ folder
  2. Run --map to execute the full pipeline:
     - Fetches spaces.json from Packmind API
     - Processes .jsonl files into {space-slug}.yaml + {space-slug}.minified.yaml
     - Generates {space-slug}.standards-mapping.yaml for each space using LLM
  3. Run --import to import standards to Packmind V3:
     - Scans res/ for .standards-validation.json files
     - Shows file list with standards/rules count
     - Prompts to select files (enter numbers or press Enter for all)
     - Imports selected files to Packmind V3

  Note: --get-spaces and --init are available for manual control/debugging.

Environment Variables:
  SOURCE_PACKMIND_API_KEY              Required for --map/--get-spaces: Your Packmind API key
  OPENAI_API_KEY                       Required for --map: Your OpenAI API key
  OPENAI_MODEL                         Optional for --map: Model to use (default: gpt-5.1-mini)
  PACKMIND_V3_API_KEY                  Required for --import: Your Packmind V3 API key

Examples:
  npx packmind-legacy-import --map                    # Run full pipeline (recommended)
  npx packmind-legacy-import --get-spaces             # Fetch spaces only (debug)
  npx packmind-legacy-import --init                   # Process .jsonl files only (debug)
  npx packmind-legacy-import --init file.jsonl        # Process single file
  npx packmind-legacy-import --stats
  npx packmind-legacy-import --import                 # Interactive import of validation files
  npx packmind-legacy-import --import --one           # Import first standard only per file
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

  if (relevantArgs.includes('--import')) {
    // Check for --one flag
    const importOne = relevantArgs.includes('--one');

    return {
      command: 'import',
      importOne,
    };
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
  const match = /^(.+)\.minified\.yaml$/.exec(filename);
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
 * Imports validation data to Packmind V3
 * @param filesToImport - Array of validation file stats to import
 * @param importOne - If true, only import the first standard from each file
 * @throws Error if API key is missing or API call fails
 */
async function importValidationFiles(
  filesToImport: ValidationFileStats[],
  importOne: boolean = false
): Promise<void> {
  const apiKey = process.env['PACKMIND_V3_API_KEY']?.trim();

  if (!apiKey || apiKey.length === 0) {
    throw new Error('PACKMIND_V3_API_KEY environment variable is not set or is empty. Please set it in your .env file or environment.');
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Importing to Packmind V3');
  console.log('='.repeat(60));
  if (importOne) {
    console.log('Mode: First standard only (--one)');
  }
  console.log('');

  const connector = new PackmindV3Connector(apiKey);
  let successCount = 0;
  let errorCount = 0;

  for (const fileStats of filesToImport) {
    console.log('-'.repeat(60));
    console.log(`Importing: ${fileStats.filename}`);
    console.log('-'.repeat(60));

    try {
      // Load the validation file
      const data = JSON.parse(readFileSync(fileStats.path, 'utf-8')) as ValidationOutput;

      // Determine which standards to import
      let standardsToImport = data.standards;
      if (importOne && data.standards.length > 0) {
        const firstStandard = data.standards[0];
        if (firstStandard) {
          standardsToImport = [firstStandard];
          console.log(`  Mode: Importing first standard only`);
        }
      }

      console.log(`  Standards to import: ${standardsToImport.length}`);
      let totalRules = 0;
      for (const standard of standardsToImport) {
        totalRules += standard.rules?.length || 0;
      }
      console.log(`  Total rules: ${totalRules}`);
      console.log('');

      // Import each standard one by one
      let standardSuccessCount = 0;
      let standardErrorCount = 0;

      for (let i = 0; i < standardsToImport.length; i++) {
        const standard = standardsToImport[i];
        if (!standard) continue;

        const progress = `[${i + 1}/${standardsToImport.length}]`;
        const rulesCount = standard.rules?.length || 0;

        console.log(`  ${progress} Importing: "${standard.name}" (${rulesCount} rules)`);

        try {
          const singleStandardData: ValidationOutput = { standards: [standard] };
          const result = await connector.importLegacy(singleStandardData);

          console.log(`  ${progress} ✅ Success`);
          if (result.message) {
            console.log(`  ${progress}    Message: ${result.message}`);
          }
          standardSuccessCount++;
        } catch (standardError) {
          const errorMessage = standardError instanceof Error ? standardError.message : String(standardError);
          console.error(`  ${progress} ❌ Failed: ${errorMessage}`);
          standardErrorCount++;
        }
      }

      console.log('');
      console.log(`  File summary: ${standardSuccessCount} succeeded, ${standardErrorCount} failed`);

      if (standardSuccessCount > 0) {
        successCount++;
      }
      if (standardErrorCount > 0) {
        errorCount++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Error: ${errorMessage}`);
      errorCount++;
    }

    console.log('');
  }

  console.log('='.repeat(60));
  console.log('Import Summary');
  console.log('='.repeat(60));
  console.log(`Successful: ${successCount}`);
  if (errorCount > 0) {
    console.log(`Failed: ${errorCount}`);
  }
  console.log('='.repeat(60));

  if (errorCount > 0 && successCount === 0) {
    throw new Error('All imports failed');
  }
}

/**
 * Runs the import command with interactive file selection
 * 1. Discovers existing .standards-validation.json files in res/
 * 2. Prompts user to select which files to import
 * 3. Imports selected files to Packmind V3
 * @param importOne - If true, only import the first standard from each file
 * @throws Error if no validation files found or import fails
 */
async function runImportCommand(importOne: boolean = false): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const resDir = join(__dirname, '..', 'res');

  // Discover all .standards-validation.json files
  const validationFiles = discoverValidationFiles(resDir);

  if (validationFiles.length === 0) {
    throw new Error(`No .standards-validation.json files found in: ${resDir}\nUse --map to generate standards mapping and then generate validation files first.`);
  }

  // Get stats for each file
  const allStats: ValidationFileStats[] = [];
  for (const filePath of validationFiles) {
    try {
      const stats = getValidationFileStats(filePath);
      allStats.push(stats);
    } catch (error) {
      console.warn(`Warning: Could not read ${basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (allStats.length === 0) {
    throw new Error('No valid validation files could be read.');
  }

  // Prompt user for file selection
  const selectedFiles = await promptFileSelection(allStats);

  if (selectedFiles.length === 0) {
    throw new Error('No files selected for import.');
  }

  // Import selected files
  await importValidationFiles(selectedFiles, importOne);
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
      case 'import':
        await runImportCommand(args.importOne || false);
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

