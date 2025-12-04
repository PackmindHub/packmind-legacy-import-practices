/**
 * Represents a detection unit test for validating coding practices
 */
export interface DetectionUnitTest {
  description: string;
  _id: string;
  code: string;
  isCompliant: boolean;
}

/**
 * Represents a position in a file (line and character)
 */
export interface PositionPoint {
  ch: number;
  line: number;
}

/**
 * Represents a position range in a file
 */
export interface Position {
  begin: PositionPoint;
  end: PositionPoint;
}

/**
 * Represents a single line of file content
 */
export interface FileContent {
  _id: string;
  content: string;
  line: number;
}

/**
 * Represents a code file with its contents and metadata
 */
export interface FileWorkshop {
  _id: string;
  isFromPlugin: boolean;
  isFromWebExtension: boolean;
  contents: FileContent[];
  lang: string;
  path: string;
  createdBy: string;
  space: string;
  listOfMaximumNumberOfNewLineInARow: any[];
  markedIrrelevantBy: any[];
  markers: any[];
  __v: number;
}

/**
 * Represents a code correction suggestion
 */
export interface CorrectionContent {
  line: number;
  content: string;
}

/**
 * Represents a correction with metadata
 */
export interface Correction {
  _id: string;
  contents: CorrectionContent[];
  user: string;
  date: string;
  pinned: boolean;
}

/**
 * Represents an example of code following (or not following) a practice
 */
export interface Example {
  _id: string;
  position: Position;
  isReviewed: boolean;
  isFromPlugin: boolean;
  isFromWebExtension: boolean;
  isHiddenInPlugin: boolean;
  description: string;
  craftTagReference: string;
  space: string;
  user: string;
  fileWorkshop: FileWorkshop;
  date: string;
  isPositive: boolean;
  usedAsExample: boolean;
  comments: any[];
  corrections: Correction[];
  __v: number;
}

/**
 * Represents guidelines for implementing a coding practice
 */
export interface Guidelines {
  practiceId: string;
  guidelines: string;
}

/**
 * Represents an assessment score for a detection strategy or technique
 */
export interface StrategyAssessment {
  details: string;
  score: number;
}

/**
 * Represents tooling configuration for detecting coding practice violations
 */
export interface Toolings {
  _id: string;
  practiceId: string;
  status: string;
  taskId: string;
  detectionStrategy: string;
  detectionStrategySyntaxAssessment: StrategyAssessment;
  detectionStrategySemanticAssessment: StrategyAssessment;
  detectionTechnique: string;
  detectionTechniqueProgramAssessment: StrategyAssessment;
  detectionTechniqueRegexAssessment: StrategyAssessment;
  regexes: any[];
  regexesDescription: any[];
  program: string;
  programDescription: string;
  language: string;
  sourceCodeState: string;
  imported: boolean;
  logs: any[];
  __v: number;
}

/**
 * Represents the parsed practice object with the required properties
 * Note: guidelines and toolings are optional and may not be present in all practice objects
 */
export interface ParsedPractice {
  name: string;
  description: string;
  categories: string[];
  suggestionsDisabled?: boolean;
  detectionUnitTests?: DetectionUnitTest[];
  examples: Example[];
  guidelines?: Guidelines;
  toolings?: Toolings;
  space: string; // ObjectId reference to the space
}

// ============================================================================
// YAML Export Types
// ============================================================================

/**
 * Represents a code example for YAML export
 */
export interface CodeExample {
  source: 'unit_test' | 'file_workshop';
  description: string;
  language: string;
  filePath?: string;
  code: string;
  isPositive: boolean;
}

/**
 * Represents a code example without the isPositive field (for YAML output)
 */
export type CodeExampleOutput = Omit<CodeExample, 'isPositive'>;

/**
 * Represents separated examples by compliance
 */
export interface SeparatedExamples {
  positive: CodeExampleOutput[];
  negative: CodeExampleOutput[];
}

/**
 * Represents a practice formatted for YAML export
 */
export interface YamlPractice {
  name: string;
  description: string;
  categories: string[];
  language?: string;
  positive_examples: CodeExampleOutput[];
  negative_examples: CodeExampleOutput[];
}

/**
 * Represents the root structure of the YAML output
 */
export interface YamlOutput {
  practices: YamlPractice[];
}

// ============================================================================
// Validation Export Types (--validate command)
// ============================================================================

/**
 * Represents a code example in the validated output
 */
export interface ValidatedExample {
  code: string;
  language: string;
}

/**
 * Represents the detection program for a rule
 */
export interface DetectionProgram {
  code: string;
  description: string;
  language: string;
  mode: 'AST' | 'RAW';
}

/**
 * Represents a rule (converted from a practice) in the validated output
 */
export interface ValidatedRule {
  name: string;
  positiveExamples: ValidatedExample[];
  negativeExamples: ValidatedExample[];
  detectionProgram?: DetectionProgram;
}

/**
 * Represents a standard containing multiple rules in the validated output
 */
export interface ValidatedStandard {
  name: string;
  description: string;
  rules: ValidatedRule[];
}

/**
 * Represents the root structure of the validation output
 */
export interface ValidationOutput {
  standards: ValidatedStandard[];
}

/**
 * Represents a space mapping entry (from spaces.json)
 */
export interface SpaceMapping {
  _id: string;
  name: string;
}

