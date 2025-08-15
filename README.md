This repository serves as the central resource for all developers at our organization. It contains the default guidelines, templates, and documentation that govern our development processes across all projects.

Our goal is to create a consistent, high-quality, and efficient workflow that empowers everyone to do their best work.

---

## 🚀 Our Standard Development Workflow

To ensure code quality and a smooth deployment process, all code changes must follow this workflow.

**1. Get a Task ✅**
   - All work must originate from an issue in github. This ensures every change has a clear purpose and is tracked.

**2. Create a Branch 🌿**
   - Never commit directly to `main` or `develop`.
   - Create your branch from the latest version of the `develop` branch.
   - **Branch Naming Convention:** `[type]/[ticket-number]-[short-description]`
   - **Examples:**
     - `feature/PROJ-123-add-user-login`
     - `bugfix/PROJ-456-fix-api-crash`

**3. Commit Your Work 💾**
   - Make small, logical commits with clear messages.
   - **Commit Message Format:** Start with a type (`feat`, `fix`, `docs`, `chore`), followed by a concise description.
   - **Example:** `feat: Add email validation to the signup form`

**4. Open a Pull Request (PR) 📬**
   - When your code is ready for review, open a Pull Request to merge your branch into `develop`.
   - **Use the PR Template:** The description will be pre-filled with our template. Please fill it out completely to give reviewers the context they need. A good description is essential for a fast review.

**5. Code Review & Merge 🔄**
   - At least one other developer must review and approve your PR.
   - Once approved and all automated checks have passed, your PR will be merged.

**6. Prepare for Deployment 🚢**
   - Merged features are bundled into releases.
   - To request a deployment, a tech lead will open a **"CAB Change Request"** issue using the provided template. This is our formal process for getting deployment approval.

---

## 📝 Using Our Templates

This repository provides default templates to streamline our processes. When you create a new Pull Request or Issue in any of our repositories, you will see options to use them.

* **Pull Request Template:** Used for all code changes.
* **Bug Report (Issue):** Used to report bugs in a structured way.
* **CAB Change Request (Issue):** The formal "fillable form" used to request a deployment to production.

---
