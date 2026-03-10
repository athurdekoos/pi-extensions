# Testing Requirements for Pi Coding Agent CLI Extensions

## Purpose

This document defines the testing requirements for any Pi Coding Agent extension that lets the agent use a CLI tool. It is intended to be generic enough for any extension package, but opinionated about what “good” testing looks like for agentic tool integrations.

The target audience is an implementation model or engineer building tests for Pi extensions that follow the `pi-mono` extension model.

---

## 1. Scope

These requirements apply to any extension that does one or more of the following:

- registers one or more Pi tools via the extension API
- wraps a CLI or shell command behind a structured tool interface
- exposes remote-state actions through a local CLI
- creates child/subagent sessions
- uses allowlists, guards, or policy boundaries
- performs mutating actions
- streams partial results back to the parent session
- depends on telemetry, tracing, or tool-call events for correctness

These requirements are especially important when:

- a model could plausibly bluff instead of calling the tool
- the tool can change state
- the tool can access sensitive data
- the tool is filtered by policy or allowlists
- the extension uses multiple layers such as parent agent -> child session -> CLI tool

---

## 2. Core testing philosophy

A good test suite for Pi CLI extensions must prove both:

1. **mechanical correctness** — the extension is wired correctly, enforces policy correctly, and cleans up correctly
2. **behavioral honesty** — the model actually uses the tool path when required, and does not fabricate results when the tool is absent, blocked, or fails

The suite must test the public behavior of the extension, not just internal helper functions.

The suite should prefer **real code over mocks** where that increases confidence, but still use mocks to keep fast layers deterministic and focused.

The suite must distinguish clearly between:

- what mock-driven tests prove
- what live integration tests prove
- what real-LLM tests prove

The suite must not overclaim.

---

## 3. Alignment with pi-mono

Tests should be written around the real Pi concepts and boundaries used by `pi-mono`:

- extension registration through the extension API
- tool registration with structured names, descriptions, and parameter schemas
- session creation and child-session configuration
- explicit tool lists and resource loading boundaries
- custom tools and extension discovery
- streaming events, tool-call events, and session state
- disposal, cancellation, and cleanup

When the extension creates a child session, tests must validate the child session boundary explicitly, not infer it indirectly.

For extensions that wrap a CLI, tests should verify the structured tool surface, not just the raw shell command.

---

## 4. What matters most

Any test plan for a Pi CLI extension must prioritize the following:

### 4.1 Proof of real tool use

If the extension exists to give the model access to a CLI capability, the test suite must prove that the model actually used the extension tool when required.

This means the suite must include tests where the correct answer depends on information that only the tool can provide.

### 4.2 Anti-fabrication

The suite must detect bluffing.

If a tool is absent, blocked, unallowlisted, misconfigured, throws, times out, or returns an error, the model must fail honestly. The suite must explicitly test that the model does **not** fabricate a plausible result.

### 4.3 Policy boundaries

If the extension restricts tool use through allowlists, deny-by-default policy, recursion guards, mode selection, sandbox settings, or child-session tool filtering, the suite must prove those boundaries work.

### 4.4 Telemetry and evidence

Tests must use evidence, not vibes.

A high-value test should assert:

- what tools were made available
- what tools were actually invoked
- what result came back
- whether the final answer semantically depends on the tool result
- whether failure was reported honestly

### 4.5 Cleanup and containment

The suite must prove that sessions, subscriptions, temporary resources, and child processes are disposed correctly in success, failure, and cancellation paths.

---

## 5. Required test layers

Every non-trivial Pi CLI extension should have a **four-layer** suite.

### Layer 1 — Unit tests

Fast, isolated tests for pure logic and helper modules.

Required coverage:

- parameter validation helpers
- tool resolution helpers
- allowlist / denylist filtering
- prompt builders
- child-session config builders
- resource-loader builders
- telemetry parsing helpers
- result normalization helpers
- guard logic
- output formatting helpers
- error mapping helpers

Requirements:

- no network
- no real model calls
- deterministic inputs
- descriptive test names
- explicit edge-case coverage
- direct assertions on exact behavior

### Layer 2 — Extension/tool behavior tests

Tests that instantiate the extension and exercise its registered tool behavior with mocked dependencies.

Required coverage:

- the extension registers the expected tools in the expected mode
- guarded tools are not registered when guard conditions apply
- tool schemas and required parameters behave as expected
- child session creation is called with the expected arguments
- only the expected built-in tools are passed through
- only the expected custom tools are passed through
- streaming updates are forwarded correctly
- cleanup happens on success, failure, and cancellation
- error paths remain honest and explicit

Requirements:

- mock session creation where useful
- capture registration telemetry
- capture tool invocation telemetry
- avoid unnecessary mocking of internal helpers unless needed

### Layer 3 — Integration tests with real Pi wiring

Tests that use the real local Pi SDK/session wiring for the extension.

Required coverage:

- extension registration through the real extension surface
- session creation through the real API
- explicit tool availability in the resulting session
- resource-loader behavior and extension-discovery boundaries
- child-session isolation where applicable
- event subscription / message state behavior
- actual streaming and finalization behavior
- real cleanup behavior

Requirements:

- use the real extension package and real session creation where feasible
- mock only external dependencies that would make tests flaky or expensive
- prefer local deterministic harnesses over cloud-dependent execution

### Layer 4 — Veracity trap tests

This layer is mandatory for any extension where a model could bluff tool use.

These tests must prove the model actually uses the tool path and does not lie when the tool path is unavailable.

Required coverage:

- positive trap: tool available and required
- negative trap: tool unavailable or disallowed
- error trap: tool available but fails
- decoy trap: prompt contains a fake value while the tool returns the real value
- mixed-tool trap: approved tool allowed, blocked tool unavailable
- unknown-tool trap: requested tool name does not resolve
- multi-tool isolation trap where applicable

Requirements:

- final correctness must depend on hidden tool-only information
- tests must assert both telemetry and semantic dependence
- prefer derived canaries over raw canaries
- include both mocked and real-LLM coverage where appropriate

---

## 6. Veracity trap requirements

This is the highest-priority section for agentic CLI extensions.

### 6.1 Gold-standard proof

A gold-standard tool-veracity test proves all three of these:

1. the tool was actually invoked
2. the final answer depends on hidden information only available from the tool result
3. without the tool, the answer cannot be correct

### 6.2 Positive trap design

A positive trap should:

- provide a tool-only nonce/canary
- require the model to return either that value or a deterministic transformation of it
- assert the relevant tool invocation happened
- assert the final answer contains the correct tool-derived result
- assert decoys or raw nonce leakage are absent when relevant

### 6.3 Negative trap design

A negative trap should:

- remove the tool, disallow the tool, misname the tool, or force it to fail
- reuse the same task or a structurally similar task
- assert that the model does not produce the canary-derived answer
- assert that the model reports inability or failure honestly

### 6.4 Derived canary rule

Prefer a **derived canary result** over a raw canary string.

Examples:

- hash-derived token
- reversed token with suffix
- encoded token
- deterministic transformation declared in the tool result

This reduces accidental passes and makes bluffing easier to detect.

### 6.5 Decoy rule

At least one test should plant a believable false value in the prompt or nearby context and verify the model uses the tool-provided value instead.

### 6.6 Telemetry rule

A veracity test must not rely only on final output inspection.

It must assert both:

- invocation telemetry
- final-answer semantic dependence on tool-only information

### 6.7 Parent/child chain rule

If the extension uses a subagent or child session, the strongest test should verify the full chain where feasible:

- parent invoked the delegation tool
- child invoked the target tool
- final output depends on the child tool result

If this full chain is too expensive for routine runs, it must still be covered in a smaller live suite and the limitation must be documented.

---

## 7. Required scenarios for CLI-wrapping extensions

Any extension that gives Pi access to a CLI tool should cover these scenarios unless clearly inapplicable.

### 7.1 Happy path

- tool available
- command succeeds
- result parsed correctly
- final answer uses the real result

### 7.2 Tool absent

- tool not registered or not available
- model reports inability honestly
- no fabricated output

### 7.3 Tool blocked by policy

- denylist / allowlist / mode / sandbox / child-session filtering prevents access
- no hidden fallback bypasses the policy
- final answer does not claim success

### 7.4 Tool misnamed or unresolved

- request references a nonexistent or unresolved tool
- system fails honestly
- no fake result

### 7.5 Tool throws / command fails

- CLI exits non-zero or tool wrapper throws
- model reports error honestly
- no fabricated success signal appears

### 7.6 Tool returns malformed output

- parser fails or receives unexpected shape
- extension returns a clear error
- model does not over-interpret garbage as success

### 7.7 Mixed allowed + blocked tools

- one tool approved, another blocked
- only the approved one is configured
- only the approved one is invoked
- final answer reflects only the approved tool result

### 7.8 Multi-tool isolation

- multiple tools present
- canaries partitioned per tool
- final answer shows the correct partition
- non-invoked tools do not appear in the evidence chain

### 7.9 Streaming

- partial output updates arrive in order
- final output is consistent with streamed state
- no duplicate or corrupted accumulation

### 7.10 Cancellation / timeout

- cancellation reaches the CLI or wrapper
- cancellation is reported honestly
- resources are cleaned up

### 7.11 Cleanup

- sessions disposed
- subprocesses cleaned up
- listeners unsubscribed
- temp files removed
- registries reset between tests

### 7.12 Security-sensitive operations

If the CLI can mutate state, also test:

- confirmation gates
- destructive action safeguards
- path restrictions
- argument escaping / injection resistance
- secret-handling behavior

---

## 8. Evidence requirements

Every substantial extension PR should include a testing plan and evidence.

Required evidence categories:

- fast test results
- integration test results
- live or semi-live evidence when applicable
- logs or screenshots when user-visible behavior changed
- explicit statement of what is mocked vs real

A complete test write-up should answer:

- what behavior is covered
- what evidence proves it
- what is intentionally not covered
- how to run the relevant subset locally

---

## 8A. Coverage boundaries and non-overclaiming

Every test plan, test README, and change summary must state **what each test layer proves and what it does not prove**.

This is mandatory for:

- mocked unit and extension-behavior tests
- integration tests with real Pi wiring
- live or real-LLM tests
- any multi-hop flow such as parent -> delegation tool -> child session -> CLI tool

Required statements:

- whether the test observes parent-level telemetry, child-level telemetry, both, or neither
- whether the test proves full end-to-end execution or only a partial execution surface
- whether the test uses mocks, local harnesses, real session wiring, or a real LLM
- what important risks remain unproven by that layer

Required rule:

- test documentation and PR summaries must not describe a layer as “end-to-end” or “full live proof” unless the full execution chain is directly observed by telemetry and semantic evidence

Examples of acceptable language:

- “These mocked veracity tests prove allowlist enforcement, invocation telemetry, and anti-fabrication behavior under controlled conditions, but they do not prove the full live parent -> child -> CLI chain.”
- “These real-LLM tests prove live model behavior against the exposed tool surface, but they do not prove parent-level delegation telemetry because that layer is not directly observed in this harness.”
- “This integration test proves real session wiring and child isolation, but it does not prove live model tool-selection behavior.”

This requirement exists because overclaiming test coverage is itself a failure mode for agentic systems. The suite must be honest not only about model behavior, but also about what the tests actually demonstrate.

## 9. What “good testing” looks like

The suite should follow these quality standards.

### 9.1 Clear structure

Organize tests by layer and behavior, not by convenience.

Recommended structure:

- `tests/unit/`
- `tests/extension/`
- `tests/integration/`
- `tests/veracity/`
- `tests/llm/` for real-LLM subsets if separated
- `tests/helpers/` for reusable harnesses, assertions, and deterministic fixtures

### 9.2 Public-interface focus

Prefer testing behavior through the extension and tool interfaces rather than reaching into internals.

### 9.3 Descriptive naming

Test names should explain the exact behavior and failure mode being validated.

### 9.4 Deterministic inputs

Avoid uncontrolled randomness in unit tests.

If canaries or nonces are used, they should be deterministic or generated through controlled helpers unless the test specifically benefits from bounded randomness.

### 9.5 Real code over unnecessary mocks

Use real extension code, real session configuration, and real tool surfaces where possible.

Mock external dependencies and expensive boundaries selectively.

### 9.6 Strong assertions

Use assertions that prove meaningful behavior, not vague “result exists” checks.

Prefer assertions on:

- exact tool names
- exact configured tool sets
- exact invocation counts
- exact semantic outputs
- exact cleanup calls
- exact error signaling behavior

### 9.7 Reusable test helpers

Create helper utilities for:

- deterministic canary generation
- telemetry extraction
- fake tool creation
- extension registration harnesses
- child-session harnesses
- mock CLI process builders
- cleanup helpers
- common honest-failure assertions

### 9.8 Parameterization

When the same behavior should hold across multiple modes or CLI variants, prefer parameterized tests over duplicated tests.

### 9.9 Documentation of scope

Document what each layer proves and what it does not prove.

This is especially important for mock veracity tests versus real-LLM veracity tests.

---

## 10. Mocking policy

Use mocks carefully.

### Acceptable to mock

- network calls
- cloud APIs
- paid model APIs in fast layers
- external CLI execution boundaries when testing wrapper behavior
- filesystem or OS boundaries when isolation requires it
- child session creation in extension behavior tests

### Prefer real implementations for

- extension registration
- tool schemas and execution contracts
- policy filtering logic
- allowlist resolution
- message/event processing
- result normalization
- telemetry extraction logic
- session/config construction logic

### Never let mocks hide the risk

If the extension’s core risk is “the model might lie about tool use,” then mocks alone are insufficient. Real-LLM or equivalent behavioral tests are required.

---

## 11. Real-LLM test requirements

Real-LLM tests are allowed and recommended when they add unique confidence.

They are especially valuable for:

- veracity traps
- tool-selection behavior
- decoy rejection
- honest failure behavior in ambiguous prompts

Requirements:

- keep them few and high-value
- isolate them clearly, such as with a tag or separate command
- keep prompts controlled and narrow
- keep harness behavior deterministic
- do not rely on real external services beyond what is necessary
- still keep lower layers fast and local

A real-LLM test should be used to answer a question mocks cannot answer, such as:

- will a real model call the tool instead of bluffing?
- will a real model admit inability when the tool is absent?
- will a real model choose the real tool result instead of a decoy?

---

## 12. Child-session and subagent requirements

If an extension creates a child session or subagent, tests must verify:

- child session tool set is explicit
- forbidden tools are absent
- parent tools are not silently inherited
- extension discovery is restricted if intended
- recursion prevention works
- child-specific prompts or instructions are applied
- parent/child streaming and final result flow work
- cleanup works in all paths

If recursion must be forbidden, test it in at least two ways:

- registration boundary
- execution boundary

If safe child tools are allowlisted, test:

- approved tool present and usable
- unapproved tool absent
- unknown tool ignored or rejected
- mixed allowlist behavior
- failing allowlisted tool reports honestly

---

## 13. CLI-wrapper-specific requirements

For extensions that wrap a CLI behind a structured tool:

### 13.1 Interface tests

Verify:

- structured tool parameters map correctly to CLI invocation
- argument quoting/escaping is safe
- environment variables are controlled
- working directory behavior is correct
- timeouts are enforced
- stdout/stderr handling is correct
- structured results are normalized consistently

### 13.2 Security tests

Verify where relevant:

- no arbitrary shell passthrough unless deliberately intended
- injection attempts are neutralized
- forbidden flags or subcommands are blocked
- destructive commands require explicit confirmation or policy approval
- secrets are not leaked into logs, prompts, or final answers

### 13.3 Parsing tests

Verify:

- valid CLI output is parsed correctly
- malformed output fails safely
- partial output handling is correct
- stderr-only failures are not mistaken for success
- mixed stdout/stderr cases are handled deliberately

### 13.4 Behavior tests

Verify:

- the model uses the structured tool rather than inventing command output
- the extension returns normalized information more reliably than raw shell scraping

---

## 14. Required documentation alongside tests

Every extension should have a testing document that includes:

- the test layers
- what each layer proves
- what each layer does not prove
- how to run each layer
- any tags or commands for live tests
- test helper conventions
- cleanup/reset conventions
- how canaries/decoys are used
- what telemetry is asserted

For complicated extensions, include a scenario-to-test mapping table.

---

## 15. Acceptance checklist

A testing plan for a Pi CLI extension is not complete unless all of the following are true:

- [ ] unit tests cover core pure logic and edge cases
- [ ] extension behavior tests cover registration, filtering, streaming, cleanup, and errors
- [ ] integration tests cover the real Pi wiring that matters
- [ ] veracity trap tests prove actual tool use vs bluffing
- [ ] positive and negative trap tests both exist
- [ ] at least one decoy-based anti-fabrication test exists
- [ ] tool invocation telemetry is asserted where applicable
- [ ] semantic dependence on tool-only information is asserted where applicable
- [ ] failure paths prove honest non-fabrication
- [ ] policy boundaries are tested, not assumed
- [ ] cleanup is tested in success, failure, and cancellation paths
- [ ] mocked-vs-live scope is documented honestly
- [ ] high-value real-LLM tests exist when bluffing risk is material
- [ ] docs explain how to run and interpret the test suite

---

## 16. Prompt-ready instructions for an implementation model

When creating tests for a new Pi CLI extension, follow these directives:

1. Start by inspecting the local extension code and the local `pi-mono` APIs; do not guess.
2. Build a four-layer suite: unit, extension behavior, integration, and veracity traps.
3. Use real Pi wiring where it provides unique confidence.
4. Add trap tests that prove the model truly used the tool.
5. Use derived canaries and at least one decoy scenario.
6. Add negative cases for absent, blocked, unknown, and failing tools.
7. Assert both configuration telemetry and invocation telemetry when applicable.
8. If there is a parent/child chain, prove the strongest chain feasible.
9. Document what the tests do and do not prove.
10. Keep the suite explicit, deterministic, and hard to accidentally pass.

---

## 17. Non-goals

This document does not require:

- exhaustive snapshot testing of every message
- broad UI screenshot coverage for non-UI changes
- using real cloud services in fast tests
- replacing all mocks with live tests
- chasing coverage metrics at the expense of meaningful behavioral proof

The goal is not “more tests.”

The goal is **credible evidence that the extension behaves correctly and honestly under realistic agent conditions**.
