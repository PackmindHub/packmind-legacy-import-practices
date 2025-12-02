# Contributing to packmind-legacy-import

This project uses [Bun](https://bun.sh/) as its JavaScript runtime and build tool.

## Prerequisites

- [Bun](https://bun.sh/) v1.3.0 or later

Install Bun:

```bash
curl -fsSL https://bun.sh/install | bash
```

## Setup

Install dependencies:

```bash
bun install
```

## Development Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Run the CLI with hot reload (watches for changes) |
| `bun run typecheck` | Run TypeScript type checking |
| `bun run lint` | Run ESLint |
| `bun run lint:fix` | Run ESLint with auto-fix |
| `bun test` | Run tests |
| `bun test --watch` | Run tests in watch mode |

## Build Commands

| Command | Description |
|---------|-------------|
| `bun run build` | Build single-file executable for current platform |
| `bun run build:minify` | Build minified executable (smaller size) |
| `bun run build:linux` | Cross-compile for Linux x64 |
| `bun run build:windows` | Cross-compile for Windows x64 |

The executable is output to `./dist/packmind-legacy-import`.

## Running the Executable

After building:

```bash
./dist/packmind-legacy-import --help
```

## Environment Variables

Create a `.env` file in the project root (Bun loads it automatically):

```env
SOURCE_PACKMIND_API_KEY=your-source-api-key
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini  # optional
PACKMIND_V3_API_KEY=your-v3-api-key
```

## Project Structure

```
src/
├── index.ts                    # CLI entry point
├── types.ts                    # TypeScript type definitions
├── PackmindAPI.ts              # Source Packmind API client
├── PackmindV3Connector.ts      # Target Packmind V3 API client
├── PracticeToStandardConvertor.ts  # Converts practices to standards
├── CategoryMapper.ts           # LLM-based category mapping
├── YamlExporter.ts             # YAML export utilities
├── YamlMinifier.ts             # YAML minification
└── *.test.ts                   # Test files
```

## CLI Usage

```bash
# Run full pipeline (recommended)
./dist/packmind-legacy-import --map

# Individual commands
./dist/packmind-legacy-import --get-spaces    # Fetch spaces from API
./dist/packmind-legacy-import --init          # Process JSONL files
./dist/packmind-legacy-import --validate      # Generate validation JSON
./dist/packmind-legacy-import --import file.json  # Import to Packmind V3
```

