# Contributing to AgentFlow

Thank you for your interest in contributing to **AgentFlow**, an open-source AI workflow builder and trace runner maintained by **SPManchester Private Limited**.

We welcome contributions from engineers, researchers, and developers worldwide. Please read through these guidelines before submitting code or proposals.

---

## 1. Code of Conduct

All contributors and community participants are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md). We maintain a collaborative, respectful, and professional environment.

---

## 2. Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/<your-username>/spm-aidev-agentflow.git
   cd spm-aidev-agentflow
   ```
3. **Check Node.js version**:
   AgentFlow requires Node.js **>= 22.5.0** (with built-in `node:sqlite`).
   ```bash
   node -v
   ```
4. **Run the test suite**:
   ```bash
   npm test
   ```

---

## 3. Development Workflow & Rules

- **Zero Runtime Dependencies**: The core server and engine rely strictly on Node.js built-in modules (`node:http`, `node:sqlite`, `node:crypto`). Do not introduce external npm dependencies to the backend runtime without prior maintainer approval.
- **Pure & Deterministic Engine**: Workflow execution in `backend/src/ai/engine.js` must remain completely deterministic. Output, durations, and costs must be reproducible.
- **No `eval()`**: The calculator parser and all dynamic execution components must use strict abstract syntax parsing without arbitrary code evaluation.
- **Preserve Reconciling Traces**: Every step execution must write a trace entry whose costs sum up exactly to the run total.

---

## 4. Branching & Commit Conventions

### Branch Names
- `feat/feature-name` for new capabilities
- `fix/bug-description` for bug fixes
- `docs/update-description` for documentation improvements
- `refactor/scope-name` for code restructuring

### Commit Message Format
We follow the Conventional Commits specification:
```
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

Examples:
- `feat(engine): add custom math operator to calculator AST`
- `fix(guardrail): correctly evaluate budget cap edge cases`
- `docs(readme): add docker deployment instructions`

---

## 5. Pull Request Checklist

Before submitting a Pull Request, ensure:
- [ ] All syntax checks pass: `npm run check`
- [ ] All 50+ live HTTP tests pass: `npm test`
- [ ] Any new tools or contracts include corresponding test cases with hand-computed expected values.
- [ ] Documentation is updated if changes impact API endpoints or configuration.

---

## 6. Questions and Community

For questions, discussions, or enterprise collaboration:
- Open a GitHub Discussion or Issue in this repository.
- Email the maintainers at **info@spmanchester.com**.
- Visit our website at **[https://www.spmanchester.com](https://www.spmanchester.com)**.

Maintained by **SPManchester Private Limited**  
Lead Architect: **Sayed Mudassar Akbar**
