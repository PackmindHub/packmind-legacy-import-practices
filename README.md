# Packmind Legacy Import

A migration tool to convert coding practices from the legacy Packmind format to the new standards-based format in Packmind AI.

## TL;DR

**What it is:** Tool to migrate coding practices from legacy Packmind to the new Packmind AI.

**Prerequisites:**
- Deploy a new Packmind instance first (new application, not an upgrade)
- Requires PostgreSQL 17, Redis, and persistent storage
- Authentication: login/password only (SSO coming in 2026)
- Runs locally — no data leaves your infrastructure

**Migration process:**
1. Export practices from legacy Packmind as `.jsonl` files
2. Generate mapping files — tool uses an LLM to group practices into standards
3. Review and edit the generated standards organization
4. Import standards into the new Packmind instance

**Model changes:**
- Practices → Rules (grouped into Standards)
- Spaces → Standards (more granular organization)
- All standards import into a single space initially (prefixed with old space name for traceability)

**What doesn't migrate:**
- Regex-based detection
- Semgrep-based detection
- AI-generated linting programs migrate only if they were active and detectable

**Setup:** Requires API keys for legacy Packmind, new Packmind, and an LLM provider (OpenAI or Azure OpenAI) for the mapping step.

## Table of Contents

- [TL;DR](#tldr)
- [Overview](#overview)
- [Deploying the New Packmind Instance](#deploying-the-new-packmind-instance)
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [LLM Provider Configuration](#llm-provider-configuration)
- [Migration Workflow](#migration-workflow)
- [Key Concepts](#key-concepts)
- [Command Reference](#command-reference)
- [Development](#development)
- [Important: Keep Your Files](#important-keep-your-files)
- [License](#license)

## Overview

This migration involves deploying a **new Packmind application** (not just an upgrade) and migrating your existing practices to the new standards-based format. The new Packmind is a completely separate application with its own Helm chart, database, and infrastructure requirements.

**Important prerequisites:**
- You must deploy the new Packmind instance **before** running this migration tool
- This tool runs entirely on your local machine - no data leaves your infrastructure during migration
- The functional model has evolved: practices become **rules**, which are grouped into **standards** (replacing the old "spaces" concept)

## Deploying the New Packmind Instance

**Important:** This is a **new application**, not a simple upgrade. You need to deploy a completely new Packmind instance before running the migration tool.

### Helm Chart

The new Packmind is deployed via a dedicated Helm chart:
- **Helm Chart Repository**: [packmind-ai-helm-chart](https://github.com/PackmindHub/packmind-ai-helm-chart)
- **Version**: Make sure to enable the **"enterprise"** version during deployment (not the open-source version)

### Infrastructure Requirements

The Helm chart provides a standard architecture with the following components:

- **Application Pods**: The main Packmind application
- **PostgreSQL 17**: Database (included in the Helm chart by default, or you can use your own instance)
  - Requires a persistent volume for data storage
- **Redis**: Used for caching and background job orchestration

### Initial State

At first startup, the new Packmind instance will be **empty** - no data will be present until you complete the migration process using this tool.

### Authentication

Currently, only **hardcoded login/password authentication** is supported. SSO (Single Sign-On) will be available in 2026.

## Prerequisites for the migration script

- [Bun](https://bun.sh/) runtime (recommended) or Node.js 22.17.0+

### Installing Bun

**Linux / macOS:**
```bash
curl -fsSL https://bun.sh/install | bash
```

**Windows:**
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

## Environment Setup

Create a `.env` file at the root of the project with the following variables:

```env
# Required for --map and --get-spaces commands
# Your API key from the legacy Packmind instance
# Available from your current Packmind organization at `https://<orga_name>.packmind.app` (or from your self-hosted instance)
SOURCE_PACKMIND_API_KEY=your_legacy_packmind_api_key

# Required for --map command - LLM Provider Selection
# Choose between "OPENAI" or "AZURE_OPENAI"
LLM_PROVIDER=OPENAI

# OpenAI Configuration (when LLM_PROVIDER=OPENAI)
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.1  # Optional, default: gpt-5.1

# Azure OpenAI Configuration (when LLM_PROVIDER=AZURE_OPENAI)
AZURE_OPENAI_API_KEY=your_azure_openai_api_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=your_deployment_name
AZURE_OPENAI_API_VERSION=2024-12-01-preview  # Optional

# Required for --import command
# Your API key from the new Packmind instance (https://app.packmind.ai if on Cloud, or your custom self-hosted instance)
PACKMIND_V3_API_KEY=your_packmind_v3_api_key
```

## LLM Provider Configuration

The `--map` command uses an LLM to categorize practices into standards. You can choose between **OpenAI** or **Azure OpenAI** as your provider.

### Selecting a Provider

Set the `LLM_PROVIDER` environment variable to one of:
- `OPENAI` - Use OpenAI's API directly
- `AZURE_OPENAI` - Use Azure OpenAI Service

### OpenAI Configuration

When using `LLM_PROVIDER=OPENAI`, configure the following:

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | Your OpenAI API key |
| `OPENAI_MODEL` | No | Model to use (default: `gpt-5.1`) |

### Azure OpenAI Configuration

When using `LLM_PROVIDER=AZURE_OPENAI`, configure the following:

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_OPENAI_API_KEY` | Yes | Your Azure OpenAI API key |
| `AZURE_OPENAI_ENDPOINT` | Yes | Azure resource endpoint URL (e.g., `https://my-resource.openai.azure.com`) |
| `AZURE_OPENAI_DEPLOYMENT` | Yes | Your deployment name |
| `AZURE_OPENAI_API_VERSION` | No | API version (default: `2024-12-01-preview`) |

### Environment Variables Summary

| Variable | Required | Provider | Description |
|----------|----------|----------|-------------|
| `SOURCE_PACKMIND_API_KEY` | Yes (for --map, --get-spaces) | - | Legacy Packmind API key |
| `LLM_PROVIDER` | Yes (for --map) | - | Must be `OPENAI` or `AZURE_OPENAI` |
| `OPENAI_API_KEY` | Yes | OpenAI | Your OpenAI API key |
| `OPENAI_MODEL` | No | OpenAI | Model to use (default: `gpt-5.1`) |
| `AZURE_OPENAI_API_KEY` | Yes | Azure | Your Azure OpenAI API key |
| `AZURE_OPENAI_ENDPOINT` | Yes | Azure | Azure resource endpoint URL |
| `AZURE_OPENAI_DEPLOYMENT` | Yes | Azure | Deployment name |
| `AZURE_OPENAI_API_VERSION` | No | Azure | API version (default: `2024-12-01-preview`) |
| `PACKMIND_V3_API_KEY` | Yes (for --import) | - | New Packmind API key |

## Migration Workflow

**Prerequisites:**
- The new Packmind instance must be deployed and running before starting the migration
- This tool runs entirely on your local machine
- No data leaves your infrastructure during the migration process

### Step 1: Retrieve the `.jsonl` files

Export your practices from your current Packmind organization:
- Go to `https://<orga_name>.packmind.app` (or your self-hosted instance)
- Export your practices as `.jsonl` files 

![How to export practices from the Packmind web UI](ExportPractices.gif)

Place these `.jsonl` files in the `res/` directory. You don't need to give any particular name to these files — the tool will automatically discover and process all `.jsonl` files in the folder.

### Step 2: Run the `--map` command

```bash
bun run dev -- --map
```

This command will:
1. Load all `.jsonl` files from the `res/` directory
2. Fetch space information from your legacy Packmind instance
3. Generate `{space-slug}.standards-mapping.yaml` and `{space-slug}.standards-validation.json` files

Each output file is prefixed with the name of the Packmind space that contained the practices.

The tool uses an LLM to propose a distribution of practices into one or more standards. The goal is to create more granular, focused standards compared to the original Packmind spaces.

### Step 3: Review and edit the mapping files

Open the generated `.standards-mapping.yaml` files and review the proposed organization. You can:

- **Rename standards**: Change the name of any proposed standard
- **Redistribute practices**: Move practices between standards
- **Create new standards**: Add new standard groups as needed
- **Remove practices**: If you delete a practice from the file, it will not be imported into the new Packmind instance

Take your time to organize your standards in a way that makes sense for your team.

### Step 4: Run the `--import` command

When you're ready to import, run:

```bash
bun run dev -- --import
```

This command will:
1. Scan the `res/` directory for `.standards-validation.json` files
2. Display a list of discovered files with their standards and rules count
3. Prompt you to select which files to import (enter numbers like "1,3" or press Enter for all)
4. Ask for confirmation before importing
5. Import the selected standards to Packmind

```bash
# Import only the first standard from each file (useful for testing)
bun run dev -- --import --one
```

## Key Concepts

### Practices → Rules in Standards

The fundamental mapping in this migration is:

| Legacy Packmind | Packmind |
|-----------------|-------------|
| Practice | Rule |
| Space | Standard(s) |

A single **practice** in the legacy format becomes a **rule** within a **standard** in the new Packmind.

The goal of this migration is not just to convert practices to rules, but to **group them into meaningful, focused standards** that are more granular than the original spaces.

### Evolution of the Functional Model

The new Packmind introduces a more granular organizational structure:

- **Practices → Rules**: Each practice becomes a rule within a standard
- **Spaces → Standards**: Rules are grouped into standards (replacing the old "spaces" concept)
- **Spaces in New Packmind**: The spaces feature is not yet available in the new version but will be added in the future

This new approach enables finer granularity, allowing you to create focused standards for specific technologies or frameworks (e.g., standards dedicated to a specific ORM, test framework, etc.).

**During Import:**
- All standards are imported into a **single space** in the new Packmind instance
- Standards are **prefixed with the name of the old space** to maintain traceability
- In the future, you'll be able to move standards between spaces once that functionality becomes available

### Detection Programs

**AI-Generated Linting Programs:**
Detection programs from legacy practices are preserved **only** when:
- The practice was configured to be detectable
- The practice had an active detection program

If these conditions are not met, the detection program is not imported. You can always regenerate detection programs later using Packmind's linter feature.

**Unsupported Detection Methods:**
The following detection methods are **not supported** in the new Packmind and will **not be migrated**:
- **Regex-based detection**: Practices using regular expressions for detection are not migrated
- **Semgrep-based detection**: Practices using Semgrep patterns are not migrated

These practices can be manually regenerated later if needed. Guidance for manual regeneration is available and can be covered in a support session.

## Command Reference

| Command | Description |
|---------|-------------|
| `--map` | Run full pipeline: fetch spaces → process JSONL → generate mappings |
| `--import` | Interactively select and import validation files to Packmind V3 |
| `--import --one` | Import only the first standard from each selected file |
| `--get-spaces` | Fetch spaces from Packmind API (debug) |
| `--init` | Process JSONL files only (debug) |
| `--stats` | Display practice statistics |
| `--help` | Show help message |

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev -- --help

# Build the binary
bun run build

# Run tests
bun test
```

## Important: Keep Your Files

We recommend keeping all generated files locally after the migration is complete:

- `.jsonl` files (original exported practices)
- `.yaml` and `.minified.yaml` files (intermediate formats)
- `.standards-mapping.yaml` files (your curated organization)
- `.standards-validation.json` files (final import data)

These files serve as a backup and audit trail of your migration. They can be useful if you need to re-import, troubleshoot issues, or reference the original practice data in the future.

## License

ISC
