---
name: git-workflow
description: Professional git workflow for the Speak Aloud Extension project. Use when committing changes, managing branches, or preparing releases.
---

# Git Workflow

This skill provides a structured approach to version control for the Speak Aloud Extension.

## Commit Message Standards

Follow the "Conventional Commits" style for clarity:

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, etc)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools and libraries

### Example
`feat(tts): add support for changing speech rate`

## Workflow

1. **Check Status**: Always run `git status` and `git diff` before committing.
2. **Atomic Commits**: Keep commits focused on a single logical change.
3. **Branching**:
   - Use `main` for stable releases.
   - Use descriptive branch names like `feature/tts-rate` or `fix/pdf-rendering`.
4. **Pre-commit Checks**: Ensure the extension loads without errors in Chrome before committing.

## Tools
- `git status`
- `git diff HEAD`
- `git log -n 5`
