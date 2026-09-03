# 🤖 AI Code Reviewer

An AI-powered automated code review system that analyzes GitHub Pull Requests and provides actionable feedback on **bugs, security vulnerabilities, performance issues, and code quality**.

The project integrates AI directly into the development workflow using GitHub Actions, helping developers identify potential problems before merging their code.

---

## ✨ Features

* 🔍 **Automated Pull Request Review**

  * Automatically analyzes code changes whenever a Pull Request is created or updated.

* 🐛 **Bug Detection**

  * Identifies potential logical errors and incorrect implementations.

* 🔐 **Security Analysis**

  * Detects common security issues such as SQL injection, insecure input handling, exposed secrets, and authentication-related problems.

* ⚡ **Performance Analysis**

  * Identifies inefficient code patterns and potential performance bottlenecks.

* 📊 **Severity Classification**

  * Categorizes findings as:

    * 🔴 Critical
    * 🟠 High
    * 🟡 Medium
    * 🔵 Low

* 💬 **Inline GitHub Comments**

  * Posts review comments directly on the relevant changed lines.

* 📝 **AI-Generated PR Summary**

  * Generates a concise summary of the issues detected in the Pull Request.

* 💡 **Suggested Fixes**

  * Provides actionable recommendations and code suggestions for detected issues.

* ⚙️ **Custom Review Rules**

  * Supports project-specific coding and review guidelines.

* 🔄 **Incremental Reviews**

  * Reviews only newly added changes when a Pull Request is updated.

* 🛡️ **Confidence Filtering**

  * Low-confidence findings can be filtered to reduce unnecessary review noise.

---

## 🏗️ Architecture

```text
                    ┌─────────────────┐
                    │   Developer     │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  GitHub Pull    │
                    │    Request      │
                    └────────┬────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │    GitHub Action     │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │    Fetch PR Diff     │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │    Diff Parser       │
                  │  + File Filtering    │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │      LLM / AI        │
                  │       Analysis       │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │ Structured Findings  │
                  │ Severity + Category  │
                  └──────────┬───────────┘
                             │
                             ▼
                ┌──────────────────────────┐
                │ Filtering & Deduplication│
                └────────────┬─────────────┘
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
             Inline Comments     PR Summary
                    │                 │
                    └────────┬────────┘
                             ▼
                       Developer
```

---

## 🧠 How It Works

### 1. Pull Request Created

A developer opens or updates a Pull Request on GitHub.

### 2. GitHub Action Starts

The GitHub Actions workflow automatically triggers the AI reviewer.

### 3. Fetch Code Changes

The system retrieves the Pull Request diff using the GitHub API instead of unnecessarily processing the entire repository.

### 4. Parse and Filter

The diff is divided into manageable chunks and irrelevant files such as lockfiles, generated files, or minified files can be excluded.

### 5. AI Analysis

The selected LLM analyzes each code chunk for:

* Bugs
* Security vulnerabilities
* Performance problems
* Maintainability issues
* Code quality problems

### 6. Structured Output

Instead of relying only on free-form AI text, the reviewer expects structured findings containing information such as:

```json
{
  "severity": "high",
  "category": "security",
  "message": "Potential SQL injection vulnerability",
  "rationale": "User input is directly concatenated into the SQL query.",
  "suggestion": "Use parameterized queries.",
  "confidence": 0.94
}
```

### 7. Filtering

Low-confidence and low-severity findings can be removed. Duplicate findings are also handled to reduce review noise.

### 8. GitHub Feedback

The final findings are posted as inline comments on the Pull Request along with an overall review summary.

---

## 🛠️ Tech Stack

| Technology                  | Purpose                                                |
| --------------------------- | ------------------------------------------------------ |
| **GitHub Actions**          | Automating the review workflow                         |
| **GitHub REST API**         | Fetching Pull Request information and posting comments |
| **LLM**                     | Intelligent code analysis                              |
| **TypeScript / JavaScript** | Application and workflow logic                         |
| **Node.js**                 | Runtime environment                                    |
| **Structured Outputs**      | Machine-readable AI findings                           |
| **GitHub Secrets**          | Secure API key management                              |

---

## 🔐 Security

Security is an important part of the project.

* API keys are stored using GitHub Secrets.
* The reviewer uses minimum required GitHub permissions.
* The system does not execute the submitted Pull Request code.
* Review configuration can be controlled from the base branch.
* Sensitive credentials should never be hard-coded into the repository.

> **Important:** Never commit API keys, GitHub tokens, passwords, or other secrets to the repository.

---

## ⚙️ Setup

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/ai-code-reviewer.git

cd ai-code-reviewer
```

### 2. Configure GitHub Secret

Go to:

```text
Repository
→ Settings
→ Secrets and variables
→ Actions
→ New repository secret
```

Add the API key required by your selected AI provider.

For example:

```text
OPENAI_API_KEY
```

### 3. Configure GitHub Actions

Create:

```text
.github/
└── workflows/
    └── ai-code-review.yml
```

Example:

```yaml
name: AI Code Review

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest

    steps:
      - name: Run AI Code Reviewer
        uses: YOUR_USERNAME/ai-code-reviewer@main
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          api_key: ${{ secrets.OPENAI_API_KEY }}
```

### 4. Create a Pull Request

Create a new branch, make a code change, commit it, and open a Pull Request.

The AI reviewer will analyze the changes and generate feedback.

---

## 📋 Example Review

Suppose a developer writes:

```javascript
const query =
  "SELECT * FROM users WHERE id = " + userId;
```

The reviewer may report:

```text
🔴 HIGH — Security

Potential SQL Injection vulnerability.

User-controlled input is directly concatenated
into the SQL query.

Recommendation:
Use parameterized queries instead of string concatenation.
```

---

## 🎯 Review Categories

The reviewer can analyze code across multiple dimensions:

```text
Security
   ├── SQL Injection
   ├── Authentication issues
   ├── Authorization issues
   └── Sensitive information exposure

Bugs
   ├── Logic errors
   ├── Null/undefined handling
   └── Incorrect API usage

Performance
   ├── Unnecessary loops
   ├── Expensive operations
   └── Inefficient database access

Code Quality
   ├── Maintainability
   ├── Readability
   └── Best practices
```

---

## 🚀 Future Improvements

* [ ] Repository-level code understanding
* [ ] Multi-language code analysis
* [ ] AI-generated automated fixes
* [ ] Review analytics dashboard
* [ ] Review history and trends
* [ ] Slack/Discord notifications
* [ ] Jira issue integration
* [ ] Custom organization-level review rules
* [ ] Support for additional Git providers
* [ ] Human approval before automatically applying fixes

---

## 📈 Why This Project?

Traditional code review requires developers to manually inspect Pull Requests for bugs, security vulnerabilities, and code-quality issues.

This project aims to assist developers by providing **fast, consistent, and automated feedback** directly inside the existing GitHub workflow.

The goal is not to replace developers, but to act as an **AI-assisted first layer of code review** before human review.

---

## 🔮 Project Vision

```text
Developer
    ↓
Write Code
    ↓
Create Pull Request
    ↓
AI Code Review
    ↓
Detect Problems
    ↓
Explain Problems
    ↓
Suggest Fixes
    ↓
Human Developer Review
    ↓
Merge
```

The system combines **AI, software engineering practices, CI/CD automation, and code quality analysis** into a single development workflow.

---

## 📄 License

This project is intended for educational and development purposes.

Add the appropriate license for your implementation.
