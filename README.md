[![Open in Visual Studio Code](https://classroom.github.com/assets/open-in-vscode-2e0aaae1b6195c2367325f4f02e2d04e9abb55f0b24a779b69b11b9e10269abc.svg)](https://classroom.github.com/online_ide?assignment_repo_id=24293624&assignment_repo_type=AssignmentRepo)
# Community Services Management System

JavaScript and Express.js implementation of the Community Services Management
System for the UPHSL Programming Languages Laboratory.

## Current Scope

The starter repository contains:

- Express 5 application
- EJS starter interface
- `/health` JSON endpoint
- HTTP 404 response
- Node.js built-in test runner
- Supertest HTTP smoke tests
- instructional application architecture
- Git workflow documentation
- pull request template

The starter does not yet contain resident management, persistence,
authentication, service-request processing, or other future features.

## Technology Stack

- Node.js 24 LTS
- JavaScript using ES modules
- Express 5
- EJS
- npm
- Node test runner
- Supertest

## Sprint 0 Setup

### 1. Clone your assigned repository

```bash
git clone <your-assigned-repository-url>
cd <your-assigned-repository>
```

### 2. Verify Node and npm

```bash
node --version
npm --version
```

The required Node major version is:

```text
24
```

### 3. Install dependencies

```bash
npm ci
```

Use `npm ci` when `package-lock.json` is already available.

### 4. Run the application

```bash
npm start
```

Open:

```text
http://127.0.0.1:3000
```

Health endpoint:

```text
http://127.0.0.1:3000/health
```

### 5. Run in development watch mode

```bash
npm run dev
```

### 6. Run automated tests

```bash
npm test
```

Expected result:

```text
4 tests passed
```

### 7. Complete the developer profile

Update:

```text
ABOUT_THE_DEVELOPER.md
```

Use the required Sprint 0 commit message:

```bash
git commit -m "docs: complete developer profile"
```

## Important Rule

Do not implement future sprint requirements before their tickets are released.

Official requirements are maintained in the CSMS Specifications repository and
in Moodle.