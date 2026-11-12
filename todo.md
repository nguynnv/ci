# TODO.md — Development & GitHub Automation Protocol

## 1. PRIMARY OBJECTIVE

You are required to maintain the project's GitHub repository continuously.

**IMPORTANT: Every time you finish implementing a coding task, you MUST commit and push the completed changes to the `main` branch on GitHub.**

Do not wait for the user to remind you.

Do not leave completed work uncommitted or only stored locally.

Treat GitHub `main` as the primary source of truth for the project.

---

## 2. MANDATORY DEVELOPMENT WORKFLOW

For every coding task, follow this workflow:

### Step 1 — Understand
- Read and understand the existing project structure.
- Inspect relevant source files before modifying them.
- Understand existing architecture, dependencies, and coding conventions.
- Avoid unnecessary modifications to unrelated files.

### Step 2 — Implement
- Write clean, maintainable, and readable code.
- Follow the project's existing architecture and conventions.
- Avoid unnecessary complexity.
- Do not introduce redundant dependencies.
- Preserve existing functionality unless the task explicitly requires changing it.

### Step 3 — Verify
Before committing anything:

- Check for syntax errors.
- Run relevant tests.
- Verify that the implemented functionality works as expected.
- Fix errors introduced by your changes.
- Review the modified files.
- Check for accidentally included files, credentials, API keys, tokens, passwords, or other sensitive information.

Never push knowingly broken or incomplete code.

### Step 4 — Git Commit

Once the implementation has been verified:

1. Inspect the current Git status.
2. Review the changes using `git diff`.
3. Stage only the files relevant to the completed task.
4. Create a meaningful commit message.

Commit message examples:

- `feat: add user authentication`
- `fix: resolve database connection issue`
- `refactor: improve API architecture`
- `docs: update project documentation`
- `perf: optimize dashboard rendering`

Avoid meaningless messages such as `update`, `test`, or `changes`.

### Step 5 — Push to GitHub

**THIS STEP IS MANDATORY.**

After successfully committing:

1. Check the current branch.
2. Ensure the target branch is `main`.
3. Fetch the latest remote changes.
4. Ensure the local branch is synchronized with the remote branch.
5. Push the completed commit to `origin/main`.

Expected command:

`git push origin main`

If the current branch is not `main`, safely integrate the completed work into `main` without discarding existing changes.

If the remote repository contains new commits, integrate them safely before pushing.

Never use `git push --force` or `git push -f`.

Never overwrite or discard other contributors' work.

If a merge conflict occurs, resolve it carefully. If it cannot be resolved safely, stop and explain the problem to the user.

---

## 3. CONTINUOUS GIT MANAGEMENT

Maintain good Git hygiene throughout the development process.

- Do not accumulate unnecessary uncommitted changes.
- Do not create meaningless commits.
- Do not commit temporary build files, cache files, or generated artifacts unless required.
- Respect `.gitignore`.
- Never commit secrets or private credentials.
- Do not rewrite Git history unnecessarily.
- Do not delete remote branches.
- Do not modify repository settings without explicit authorization.

If the project does not have a Git repository or remote configured, inform the user instead of inventing repository information.

---

## 4. TASK COMPLETION RULE

A coding task is NOT considered fully completed until:

- [ ] Implementation is finished.
- [ ] Relevant tests have been executed.
- [ ] Errors introduced by the implementation have been resolved.
- [ ] Changes have been reviewed.
- [ ] Changes have been committed.
- [ ] Changes have been successfully pushed to GitHub `main`.

If pushing fails, report the exact reason and do not claim that the task is fully synchronized.

---

## 5. FINAL RESPONSE

After completing a task, provide a concise report containing:

**Implementation**
- What was implemented.
- Which files were modified.
- Any important technical changes.

**Verification**
- Which tests were performed.
- Whether they passed or failed.

**GitHub Synchronization**
- Commit hash.
- Commit message.
- Target branch.
- Push status.

Example:

Development completed successfully.

- Feature: Added dashboard analytics.
- Tests: Passed.
- Branch: `main`.
- Commit: `a1b2c3d`.
- GitHub: Successfully pushed.

---

## 6. MOST IMPORTANT RULE

**CODE → TEST → REVIEW → COMMIT → PUSH**

Repeat this process after every completed coding task.

Do not wait until the entire project is finished.

Do not wait until the end of the day.

Do not wait for the user to request a GitHub update.

Whenever you finish a meaningful implementation, synchronize it with GitHub `main` immediately.

Your responsibility does not end when the code works locally. It ends when the verified changes have been safely committed and successfully pushed to GitHub.

**Keep the repository up to date. Always.**