import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldIncludeDetection,
  addDescriptionAsCommentForLanguage,
  convertProgrammingLanguage,
  PracticeToStandardConvertor,
} from './PracticeToStandardConvertor.js';
import type {
  ParsedPractice,
  DetectionUnitTest,
  Example,
  Toolings,
} from './types.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockToolings(overrides: Partial<Toolings> = {}): Toolings {
  return {
    _id: 'tooling-1',
    practiceId: 'practice-1',
    status: 'SUCCESS',
    taskId: 'task-1',
    detectionStrategy: 'SYNTAX',
    detectionStrategySyntaxAssessment: { details: '', score: 5 },
    detectionStrategySemanticAssessment: { details: '', score: 1 },
    detectionTechnique: 'PROGRAM',
    detectionTechniqueProgramAssessment: { details: '', score: 5 },
    detectionTechniqueRegexAssessment: { details: '', score: 1 },
    regexes: [],
    regexesDescription: [],
    program: 'function checkSourceCode(ast) { return []; }',
    programDescription: 'Checks source code for violations',
    language: 'KOTLIN',
    sourceCodeState: 'AST',
    imported: true,
    logs: [],
    __v: 0,
    ...overrides,
  };
}

function createMockPractice(overrides: Partial<ParsedPractice> = {}): ParsedPractice {
  return {
    name: 'Test Practice',
    description: 'Test description',
    categories: ['Testing'],
    suggestionsDisabled: false,
    detectionUnitTests: [],
    examples: [],
    space: '671a094106587d064f56ba82',
    ...overrides,
  };
}

function createMockDetectionUnitTest(overrides: Partial<DetectionUnitTest> = {}): DetectionUnitTest {
  return {
    _id: 'test-1',
    description: 'Test description',
    code: 'fun test() {}',
    isCompliant: true,
    ...overrides,
  };
}

function createMockExample(overrides: Partial<Example> = {}): Example {
  return {
    _id: 'example-1',
    position: {
      begin: { ch: 0, line: 5 },
      end: { ch: 0, line: 10 },
    },
    isReviewed: true,
    isFromPlugin: true,
    isFromWebExtension: false,
    isHiddenInPlugin: false,
    description: 'Example description',
    craftTagReference: 'ref-1',
    space: '671a094106587d064f56ba82',
    user: 'user-1',
    fileWorkshop: {
      _id: 'workshop-1',
      isFromPlugin: true,
      isFromWebExtension: false,
      contents: [
        { _id: '1', content: 'line 1', line: 1 },
        { _id: '2', content: 'line 2', line: 2 },
        { _id: '3', content: 'line 3', line: 3 },
        { _id: '4', content: 'line 4', line: 4 },
        { _id: '5', content: 'line 5', line: 5 },
        { _id: '6', content: 'line 6', line: 6 },
        { _id: '7', content: 'line 7', line: 7 },
        { _id: '8', content: 'line 8', line: 8 },
        { _id: '9', content: 'line 9', line: 9 },
        { _id: '10', content: 'line 10', line: 10 },
        { _id: '11', content: 'line 11', line: 11 },
        { _id: '12', content: 'line 12', line: 12 },
      ],
      lang: 'kt',
      path: 'src/main/kotlin/Test.kt',
      createdBy: 'user-1',
      space: '671a094106587d064f56ba82',
      listOfMaximumNumberOfNewLineInARow: [],
      markedIrrelevantBy: [],
      markers: [],
      __v: 0,
    },
    date: '2024-01-01T00:00:00.000Z',
    isPositive: true,
    usedAsExample: true,
    comments: [],
    corrections: [],
    __v: 0,
    ...overrides,
  };
}

// ============================================================================
// shouldIncludeDetection Tests
// ============================================================================

describe('shouldIncludeDetection', () => {
  it('should return true when toolings.status is SUCCESS and suggestionsDisabled is false', () => {
    const practice = createMockPractice({
      suggestionsDisabled: false,
      toolings: createMockToolings({ status: 'SUCCESS' }),
    });
    
    expect(shouldIncludeDetection(practice)).toBe(true);
  });

  it('should return false when suggestionsDisabled is true', () => {
    const practice = createMockPractice({
      suggestionsDisabled: true,
      toolings: createMockToolings({ status: 'SUCCESS' }),
    });
    
    expect(shouldIncludeDetection(practice)).toBe(false);
  });

  it('should return false when toolings.status is FAILURE', () => {
    const practice = createMockPractice({
      suggestionsDisabled: false,
      toolings: createMockToolings({ status: 'FAILURE' }),
    });
    
    expect(shouldIncludeDetection(practice)).toBe(false);
  });

  it('should return false when toolings.status is OUTDATED', () => {
    const practice = createMockPractice({
      suggestionsDisabled: false,
      toolings: createMockToolings({ status: 'OUTDATED' }),
    });
    
    expect(shouldIncludeDetection(practice)).toBe(false);
  });

  it('should return false when toolings.status is PENDING', () => {
    const practice = createMockPractice({
      suggestionsDisabled: false,
      toolings: createMockToolings({ status: 'PENDING' }),
    });
    
    expect(shouldIncludeDetection(practice)).toBe(false);
  });

  it('should return false when toolings is undefined', () => {
    const practice = createMockPractice({
      suggestionsDisabled: false,
      toolings: undefined,
    });
    
    expect(shouldIncludeDetection(practice)).toBe(false);
  });
});

// ============================================================================
// addDescriptionAsCommentForLanguage Tests
// ============================================================================

describe('addDescriptionAsCommentForLanguage', () => {
  it('should add description as // comment for Kotlin code', () => {
    const code = 'fun test() {}';
    const description = 'This is a test';
    
    const result = addDescriptionAsCommentForLanguage(code, description, 'kt');
    
    expect(result).toBe('// This is a test\nfun test() {}');
  });

  it('should add description as # comment for Python code', () => {
    const code = 'def test(): pass';
    const description = 'This is a test';
    
    const result = addDescriptionAsCommentForLanguage(code, description, 'py');
    
    expect(result).toBe('# This is a test\ndef test(): pass');
  });

  it('should handle multi-line descriptions', () => {
    const code = 'fun test() {}';
    const description = 'Line 1\nLine 2';
    
    const result = addDescriptionAsCommentForLanguage(code, description, 'kt');
    
    expect(result).toBe('// Line 1\n// Line 2\nfun test() {}');
  });

  it('should return code unchanged when description is empty', () => {
    const code = 'fun test() {}';
    
    expect(addDescriptionAsCommentForLanguage(code, '', 'kt')).toBe(code);
    expect(addDescriptionAsCommentForLanguage(code, '   ', 'kt')).toBe(code);
  });
});

// ============================================================================
// convertProgrammingLanguage Tests
// ============================================================================

describe('convertProgrammingLanguage', () => {
  it('should convert known extensions to ProgrammingLanguage values', () => {
    expect(convertProgrammingLanguage('kt')).toBe('KOTLIN');
    expect(convertProgrammingLanguage('kts')).toBe('KOTLIN');
    expect(convertProgrammingLanguage('java')).toBe('JAVA');
    expect(convertProgrammingLanguage('py')).toBe('PYTHON');
    expect(convertProgrammingLanguage('js')).toBe('JAVASCRIPT');
    expect(convertProgrammingLanguage('ts')).toBe('TYPESCRIPT');
    expect(convertProgrammingLanguage('tsx')).toBe('TYPESCRIPT_TSX');
    expect(convertProgrammingLanguage('jsx')).toBe('JAVASCRIPT_JSX');
    expect(convertProgrammingLanguage('swift')).toBe('SWIFT');
    expect(convertProgrammingLanguage('go')).toBe('GO');
    expect(convertProgrammingLanguage('rs')).toBe('RUST');
    expect(convertProgrammingLanguage('rb')).toBe('RUBY');
  });

  it('should handle case insensitivity', () => {
    expect(convertProgrammingLanguage('KT')).toBe('KOTLIN');
    expect(convertProgrammingLanguage('Kt')).toBe('KOTLIN');
    expect(convertProgrammingLanguage('JAVA')).toBe('JAVA');
    expect(convertProgrammingLanguage('Java')).toBe('JAVA');
    expect(convertProgrammingLanguage('PY')).toBe('PYTHON');
  });

  it('should fall back to GENERIC for unknown extensions', () => {
    expect(convertProgrammingLanguage('unknown')).toBe('GENERIC');
    expect(convertProgrammingLanguage('xyz')).toBe('GENERIC');
    expect(convertProgrammingLanguage('foo')).toBe('GENERIC');
  });

  it('should return GENERIC for empty or whitespace input', () => {
    expect(convertProgrammingLanguage('')).toBe('GENERIC');
    expect(convertProgrammingLanguage('   ')).toBe('GENERIC');
  });

  it('should trim whitespace from input', () => {
    expect(convertProgrammingLanguage('  kt  ')).toBe('KOTLIN');
    expect(convertProgrammingLanguage('\tjava\n')).toBe('JAVA');
  });
});

// ============================================================================
// PracticeToStandardConvertor Tests
// ============================================================================

describe('PracticeToStandardConvertor', () => {
  let convertor: PracticeToStandardConvertor;

  beforeEach(() => {
    convertor = new PracticeToStandardConvertor({
      spacesJsonPath: 'res/spaces.json',
      standardsMappingPath: 'res/standards-mapping.yaml',
      contextLines: 2,
    });
  });

  describe('convertUnitTestToExample', () => {
    it('should convert unit test with description as comment header', () => {
      const test = createMockDetectionUnitTest({
        code: 'fun test() {}',
        description: 'This test checks something',
      });
      
      const result = convertor.convertUnitTestToExample(test, 'kt');
      
      expect(result.code).toBe('// This test checks something\nfun test() {}');
      expect(result.language).toBe('KOTLIN');
    });

    it('should convert unit test without description', () => {
      const test = createMockDetectionUnitTest({
        code: 'fun test() {}',
        description: '',
      });
      
      const result = convertor.convertUnitTestToExample(test, 'kt');
      
      expect(result.code).toBe('fun test() {}');
      expect(result.language).toBe('KOTLIN');
    });
  });

  describe('extractCodeWithContext', () => {
    it('should extract code with 2 context lines before and after', () => {
      const example = createMockExample({
        position: {
          begin: { ch: 0, line: 5 },
          end: { ch: 0, line: 7 },
        },
      });
      
      const result = convertor.extractCodeWithContext(example);
      
      // Should include lines 3-9 (5-2 to 7+2)
      expect(result).toBe('line 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9');
    });

    it('should clamp to file boundaries', () => {
      const example = createMockExample({
        position: {
          begin: { ch: 0, line: 1 },
          end: { ch: 0, line: 2 },
        },
      });
      
      const result = convertor.extractCodeWithContext(example);
      
      // Should include lines 1-4 (can't go below 1, so 1 to 2+2)
      expect(result).toBe('line 1\nline 2\nline 3\nline 4');
    });
  });

  describe('convertPracticeToRule', () => {
    it('should include unit tests when detection is valid', () => {
      const practice = createMockPractice({
        suggestionsDisabled: false,
        toolings: createMockToolings({ status: 'SUCCESS' }),
        detectionUnitTests: [
          createMockDetectionUnitTest({ isCompliant: true, code: 'positive code' }),
          createMockDetectionUnitTest({ isCompliant: false, code: 'negative code' }),
        ],
        examples: [],
      });
      
      const rule = convertor.convertPracticeToRule(practice);
      
      expect(rule.positiveExamples.length).toBe(1);
      expect(rule.negativeExamples.length).toBe(1);
      expect(rule.detectionProgram).toBeDefined();
    });

    it('should exclude unit tests when suggestionsDisabled is true', () => {
      const practice = createMockPractice({
        suggestionsDisabled: true,
        toolings: createMockToolings({ status: 'SUCCESS' }),
        detectionUnitTests: [
          createMockDetectionUnitTest({ isCompliant: true }),
          createMockDetectionUnitTest({ isCompliant: false }),
        ],
        examples: [],
      });
      
      const rule = convertor.convertPracticeToRule(practice);
      
      expect(rule.positiveExamples.length).toBe(0);
      expect(rule.negativeExamples.length).toBe(0);
      expect(rule.detectionProgram).toBeUndefined();
    });

    it('should exclude unit tests when toolings.status is not SUCCESS', () => {
      const practice = createMockPractice({
        suggestionsDisabled: false,
        toolings: createMockToolings({ status: 'FAILURE' }),
        detectionUnitTests: [
          createMockDetectionUnitTest({ isCompliant: true }),
        ],
        examples: [],
      });
      
      const rule = convertor.convertPracticeToRule(practice);
      
      expect(rule.positiveExamples.length).toBe(0);
      expect(rule.detectionProgram).toBeUndefined();
    });

    it('should always include file workshop examples', () => {
      const practice = createMockPractice({
        suggestionsDisabled: true, // Detection disabled
        toolings: createMockToolings({ status: 'FAILURE' }),
        detectionUnitTests: [],
        examples: [
          createMockExample({ isPositive: true }),
          createMockExample({ isPositive: false }),
        ],
      });
      
      const rule = convertor.convertPracticeToRule(practice);
      
      // File workshop examples should still be included
      expect(rule.positiveExamples.length).toBe(1);
      expect(rule.negativeExamples.length).toBe(1);
    });
  });

  describe('buildStandardDescription', () => {
    it('should build description with all rule descriptions', () => {
      const practices = [
        createMockPractice({ name: 'Rule A', description: 'Description A' }),
        createMockPractice({ name: 'Rule B', description: 'Description B' }),
      ];
      
      const rules = practices.map(p => convertor.convertPracticeToRule(p));
      
      const description = convertor.buildStandardDescription(rules, practices);
      
      expect(description).toContain('## rule 1: Rule A');
      expect(description).toContain('   Description A');
      expect(description).toContain('## rule 2: Rule B');
      expect(description).toContain('   Description B');
    });

    it('should handle multi-line practice descriptions', () => {
      const practices = [
        createMockPractice({
          name: 'Rule A',
          description: 'Line 1\nLine 2\nLine 3',
        }),
      ];
      
      const rules = practices.map(p => convertor.convertPracticeToRule(p));
      
      const description = convertor.buildStandardDescription(rules, practices);
      
      expect(description).toContain('## rule 1: Rule A');
      expect(description).toContain('   Line 1');
      expect(description).toContain('   Line 2');
      expect(description).toContain('   Line 3');
    });
  });
});

