# Nostr MCP Server Test Suite

This directory contains tests for the Nostr MCP server functionality.

## Overview

The test suite uses Jest to test the core functionality of the Nostr MCP server. It covers:

1. Profile and Notes operations (`profile-notes.test.ts`)
2. Zap-related functionality (`zap-tools.test.ts`)
3. NIPs search capabilities (`nips-search.test.ts`)

## Test Structure

The tests are structured as follows:

- `__tests__/mocks.ts`: Contains mock data for tests
- `__tests__/*.test.ts`: Test files for each component
- `utils/test-helpers.js`: Extracted handler logic for profile and notes
- `utils/zap-test-helpers.js`: Extracted handler logic for zap operations
- `utils/nip-test-helpers.js`: Extracted handler logic for NIP searches

## Running Tests

To run the tests, use:

```bash
npm test
```

To run a specific test file:

```bash
npm test -- __tests__/profile-notes.test.ts
```

## Test Design

The tests use mocks to simulate the Nostr network and focus on testing the business logic rather than actual network communication. This approach allows for:

1. Fast test execution
2. Deterministic behavior
3. Testing error handling and edge cases

## Test Coverage

The test suite provides basic coverage for:

- Profile retrieval
- Note retrieval
- Zap receipt processing
- Anonymous zap preparation
- NIPs search functionality

## Adding Tests

When adding new features, consider adding tests that:

1. Test the happy path (successful operation)
2. Test error handling
3. Test edge cases
4. Verify format of returned data 