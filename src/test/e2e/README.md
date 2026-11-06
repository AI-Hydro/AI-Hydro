# E2E Tests

This directory contains the end-to-end tests for the Cline VS Code extension using Playwright. These tests simulate user interactions with the extension in a real VS Code environment.

## Test Structure

The E2E test suite consists of several key components:

### Test Files

- **`auth.test.ts`** - Tests API key setup, provider selection, and navigation to settings
- **`chat.test.ts`** - Tests chat functionality including message sending, mode switching (Plan/Act), slash commands, and @ mentions
- **`diff.test.ts`** - Tests the diff editor functionality for file modifications
- **`editor.test.ts`** - Tests code actions, editor panel integration, and code selection features

### Test Infrastructure

- **`utils/helpers.ts`** - Core test utilities and fixtures including:
  - `e2e` - Main test fixture for single-root workspace tests
  - `e2eMultiRoot` - Test fixture for multi-root workspace tests
  - `E2ETestHelper` - Helper class with utilities for VS Code interaction
- **`utils/common.ts`** - Common utility functions for UI interactions
- **`utils/global.setup.ts`** - Global test setup and cleanup
- **`utils/build.mjs`** - Build script for test environment preparation

### Test Fixtures

- **`fixtures/workspace/`** - Single-root workspace test files (HTML, TypeScript, etc.)
- **`fixtures/workspace_2/`** - Additional workspace with Python provider files
- **`fixtures/multiroots.code-workspace`** - Multi-root workspace configuration
- **`fixtures/server/`** - Mock API server for testing Cline's backend interactions

## Running Tests

### Basic Test Execution

To build the test environment and run all E2E tests:

```bash
npm run test:e2e
```

To run all E2E tests without re-building the test environment (e.g. only test files were updated):

```bash
npm run e2e
```

### Debug Mode

To run E2E tests in debug mode with Playwright's interactive debugger:

```bash
npm run test:e2e -- --debug
# Or only run the tests without re-building
npm run e2e -- --debug
```

In debug mode, Playwright will:
- Open a browser window showing the VS Code instance
- Pause execution at the beginning of each test
- Allow you to step through test actions
- Provide a console for inspecting elements and state

### Additional Options

Run specific test files:
```bash
npm run e2e -- auth.test.ts
```

Run tests with specific tags or patterns:
```bash
npm run e2e -- --grep "Chat"
```

Run tests in headed mode (visible browser):
```bash
npm run e2e -- --headed
```

### Testing the packaged VSIX

By default the suite loads the checkout through `--extensionDevelopmentPath`. To run the installed
Learning Pack specs (`@phase1-pack`, `@phase1-charts`, `@phase1-large-course`) against a packaged build instead, point
`AIHYDRO_E2E_VSIX` at a `.vsix`. Each test installs it with the VS Code CLI into its own clean
extensions dir and launches VS Code on that dir alone, so the code under test is the shipped bytes:

```bash
npm run package:vsix -- --out /tmp/ai-hydro.vsix   # needs a clean git tree
AIHYDRO_E2E_VSIX=/tmp/ai-hydro.vsix npx playwright test -c playwright.config.ts \
  src/test/e2e/learning-pack-install.test.ts src/test/e2e/learning-pack-charts.test.ts \
  src/test/e2e/studio-large-course.test.ts --grep '@phase1-(pack|charts|large-course)'
```

The restart test closes and relaunches VS Code, then issues the install command again, which returns `noop` and reopens the course. Studio does not restore the course on its own after a restart, so this is a reinstall-noop reopen, not a restore.

CI does this on Ubuntu, macOS and Windows in `studio-vsix-e2e.yml`. Dispatch it with `repeat` set to 20 to
measure the flake rate (`scripts/e2e-repeat.mjs`: a fresh process per run, retries disabled).

### Known first-load failure (cause unknown)

One failure was seen in 19 local runs of the 12-module course path on the fixed build: the first module's
document opened with no Run bridge and the trust bar never appeared ("Studio trust bar never offered or
confirmed execution"). It did not reproduce in 12 further cold runs (6 on the fixed build, 6 on the #161 base),
so the cause is unknown. The `lifecycle` fixture now prints, on any failure only, the shell load sequence
(shell mounts, ready messages and document pushes, as event kinds with seconds since launch) and per frame the
trust-bar state (allow/revoke buttons), course header, iframe count, cell status and bridge presence. It prints
structure only, never course text, so it is safe in the log of a private caller. If it recurs in CI, read the
`[lifecycle-diagnostics]` lines first.

## Writing Tests

### Basic Test Structure

Use the `e2e` fixture for single-root workspace tests:

```typescript
import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Test description", async ({ sidebar, helper, page }) => {
  // Configure the isolated AI-Hydro test provider
  await helper.signin(sidebar)
  
  // Test interactions
  const inputbox = sidebar.getByTestId("chat-input")
  await inputbox.fill("Hello, AI-Hydro!")
  await sidebar.getByTestId("send-button").click()
  
  // Assert the stable outcome, not a transient loading frame
  await expect(sidebar.getByText("Hello! I'm a mock AI-Hydro API response.")).toBeVisible()
})
```

For multi-root workspace tests, use `e2eMultiRoot`:

```typescript
import { e2eMultiRoot } from "./utils/helpers"

e2eMultiRoot("[Multi-roots] Test description", async ({ sidebar, helper }) => {
  // Test implementation
})
```

### Available Fixtures

The test fixtures provide the following objects:

- **`sidebar`** - Playwright Frame object for the Cline extension's sidebar
- **`helper`** - E2ETestHelper instance with utility methods
- **`page`** - Playwright Page object for the main VS Code window
- **`app`** - ElectronApplication instance for VS Code
- **`server`** - Mock API server for backend testing

### Common Patterns

#### Authentication
```typescript
// Sign in with test API key
await helper.signin(sidebar)
```

#### Chat Interactions
```typescript
const inputbox = sidebar.getByTestId("chat-input")
await inputbox.fill("Your message")
await sidebar.getByTestId("send-button").click()
```

#### Mode Switching
```typescript
const actButton = sidebar.getByRole("radio", { name: "Act" })
const planButton = sidebar.getByRole("radio", { name: "Plan" })
await actButton.click() // Switch to Plan mode
```

#### File Operations
```typescript
// Open file explorer and select code
await openTab(page, "Explorer ")
await page.getByRole("treeitem", { name: "index.html" }).locator("a").click()
await addSelectedCodeToClineWebview(page)
```

#### Settings Navigation
```typescript
await sidebar.getByText("settings").click()
await sidebar.getByTestId("tab-api-config").click()
```

### Using the Recorder with Debug Mode

The `--debug` flag enables Playwright's interactive debugging features:

1. **Start debugging session:**
   ```bash
   npm run test:e2e -- --debug
   ```

2. **Playwright will open:**
   - A VS Code window with Cline extension loaded
   - Playwright Inspector for step-by-step debugging
   - Browser developer tools for element inspection

3. **Recording interactions:**
   - Use the "Record" button in Playwright Inspector
   - Interact with the VS Code interface
   - Playwright generates test code automatically
   - Copy the generated code into your test files

4. **Debugging existing tests:**
   - Set breakpoints in your test code
   - Use the "Step over" button to execute line by line
   - Inspect element selectors and page state
   - Modify selectors and retry actions

### Test Environment

The test environment includes:

- **VS Code Configuration:**
  - Disabled updates, workspace trust, and welcome screens
  - Extension development mode with Cline loaded
  - Temporary user data and extensions directories

- **Mock API Server:**
  - Runs on `http://localhost:7777`
  - Provides mock responses for Cline API calls
  - Supports authentication, chat completions, and user management

- **Test Workspaces:**
  - Single-root workspace with HTML, TypeScript, and README files
  - Multi-root workspace with Python provider examples
  - Configurable through fixtures

### Best Practices

1. **Use semantic selectors:**
   ```typescript
   // Good - uses test IDs
   sidebar.getByTestId("chat-input")
   
   // Good - uses roles and accessible names
   sidebar.getByRole("button", { name: "Send" })
   
   // Avoid - brittle CSS selectors
   sidebar.locator(".chat-input-class")
   ```

2. **Wait for elements:**
   ```typescript
   await expect(sidebar.getByText("Loading...")).toBeVisible()
   await expect(sidebar.getByText("Complete")).toBeVisible()
   ```

3. **Clean up state:**
   ```typescript
   // Use helper functions for common cleanup
   await cleanChatView(page)
   ```

4. **Handle async operations:**
   ```typescript
   // Wait for the stable response rather than a transient loading state
   await expect(sidebar.getByText("Response received")).toBeVisible()
   ```

5. **Test both success and error cases:**
   ```typescript
   // Test successful flow
   await helper.signin(sidebar)
   
   // Test error handling
   await expect(sidebar.getByText("API Request Failed")).toBeVisible()
   ```

### Debugging Tips

- Use `page.pause()` to pause execution and inspect the current state
- Add `console.log()` statements to track test progress
- Use `--headed` flag to see the browser window during test execution
- Check video recordings in `test-results/` for failed tests
- Use browser developer tools to inspect element selectors

### Environment Variables

- `CLINE_E2E_TESTS_VERBOSE=true` - Enable verbose logging
- `CI=true` - Adjusts timeouts and reporting for CI environments
- `GRPC_RECORDER_ENABLED=true` - Enable gRPC recording for debugging
