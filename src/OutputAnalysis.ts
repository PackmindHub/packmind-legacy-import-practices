import type { ParsedPractice } from './types.js';

/**
 * Extracts unique file extensions from a practice's examples, sorted alphabetically.
 * 
 * @param practice - The practice to extract extensions from
 * @returns Sorted array of unique file extensions (e.g., ['.kt', '.ts'])
 */
function extractFileExtensions(practice: ParsedPractice): string[] {
  return practice.examples
    .map(ex => ex.fileWorkshop?.path)
    .filter((path): path is string => Boolean(path))
    .map(path => '.' + (path.split('.').pop() ?? ''))
    .filter((ext, i, arr) => arr.indexOf(ext) === i)
    .sort();
}

/**
 * Checks if a practice has successful detection tooling.
 * 
 * @param practice - The practice to check
 * @returns True if tooling status is 'success' or 'completed'
 */
function hasSuccessfulTooling(practice: ParsedPractice): boolean {
  const status = practice.toolings?.status?.toLowerCase();
  return status === 'success' || status === 'completed';
}

/**
 * Gets the tooling status of a practice with a fallback.
 * 
 * @param practice - The practice to get status from
 * @returns The tooling status or 'N/A' if not available
 */
function getToolingStatus(practice: ParsedPractice): string {
  return practice.toolings?.status ?? 'N/A';
}

/**
 * Gets the categories of a practice sorted alphabetically.
 * 
 * @param practice - The practice to get categories from
 * @returns Sorted array of categories
 */
function getSortedCategories(practice: ParsedPractice): string[] {
  return [...practice.categories].sort();
}

/**
 * Displays statistics about a collection of parsed practices.
 * 
 * Statistics include:
 * - Total number of practices
 * - Number of practices with guidelines
 * - Number of practices with successful detection tooling (status === 'success' or 'completed')
 * - Number of practices with suggestions disabled
 * 
 * @param practices - Array of parsed practice objects to analyze
 */
export function displayPracticeStats(practices: ParsedPractice[]): void {
  const totalPractices = practices.length;
  
  const practicesWithGuidelines = practices.filter(
    practice => practice.guidelines !== undefined
  ).length;
  
  const practicesWithSuccessfulTooling = practices.filter(
    practice => hasSuccessfulTooling(practice)
  ).length;
  
  const practicesWithSuggestionsDisabled = practices.filter(
    practice => practice.suggestionsDisabled === true
  ).length;
  
  console.log(`Number of practices: ${totalPractices}`);
  console.log(`Number of practices with guidelines: ${practicesWithGuidelines}`);
  console.log(`Number of practices with a successful detection tooling: ${practicesWithSuccessfulTooling}`);
  console.log(`Number of practices with suggestions disabled: ${practicesWithSuggestionsDisabled}`);
}

/**
 * Displays a table of all practices with key metrics.
 * 
 * For each practice, displays:
 * - name: Practice name
 * - categories: Sorted list of categories
 * - codeExamples: Number of code examples
 * - unitTests: Number of detection unit tests
 * - fileExtensions: Sorted list of unique file extensions from examples
 * - suggestionsDisabled: Whether suggestions are disabled
 * - toolingStatus: Current tooling status
 * 
 * @param practices - Array of parsed practice objects to display
 */
export function displayPracticeList(practices: ParsedPractice[]): void {
  const practiceList = practices.map(practice => {
    const extensions = extractFileExtensions(practice);
    const categories = getSortedCategories(practice);

    return {
      name: practice.name,
      categories: categories.length > 0 ? categories.join(', ') : 'N/A',
      codeExamples: practice.examples.length,
      unitTests: practice.detectionUnitTests?.length ?? 0,
      fileExtensions: extensions.length > 0 ? extensions.join(', ') : 'N/A',
      suggestionsDisabled: practice.suggestionsDisabled,
      toolingStatus: getToolingStatus(practice),
    };
  });

  console.table(practiceList);
}

/**
 * Displays statistics about categories across all practices.
 * 
 * Shows distinct categories sorted by frequency in descending order,
 * with the number of practices having each category.
 * 
 * @param practices - Array of parsed practice objects to analyze
 */
export function displayCategoryStats(practices: ParsedPractice[]): void {
  // Count frequency of each category
  const categoryCount = new Map<string, number>();
  
  for (const practice of practices) {
    for (const category of practice.categories) {
      categoryCount.set(category, (categoryCount.get(category) ?? 0) + 1);
    }
  }
  
  // Convert to array and sort by frequency (descending)
  const sortedCategories = Array.from(categoryCount.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({
      category,
      practiceCount: count,
    }));
  
  console.log('\nCategory Statistics:');
  console.table(sortedCategories);
}

