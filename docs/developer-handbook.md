Development Rule

Implement only the requirements included in the current ticket.

The template establishes the application structure but intentionally leaves
future business functionality incomplete.


---

## Step 7.5: Add `docs/architecture.md`

```markdown
# JavaScript Express Application Architecture

## Overview

The JavaScript implementation uses Express.js and ES modules.

The architecture separates HTTP routing, request handling, business logic,
persistence, domain models, views, and reusable supporting functions.

## Structure

```text
src/
├── app.js
├── server.js
├── config/
├── controllers/
├── middleware/
├── models/
├── repositories/
├── routes/
├── services/
├── utils/
└── views/

public/
└── css/

test/
Responsibilities
app.js

Creates and configures the Express application.

server.js

Starts the HTTP server.

config

Contains shared application and server configuration.

routes

Maps HTTP paths to controller functions.

controllers

Handles Express requests and responses.

services

Contains application and business logic.

repositories

Contains persistence and data-access responsibilities.

models

Represents CSMS domain concepts.

middleware

Contains reusable request-processing behavior.

utils

Contains small reusable supporting functions.

views

Contains EJS templates.

public

Contains browser-accessible static assets.

test

Contains automated application tests.

Request Flow
HTTP Request
     ↓
Express Route
     ↓
Controller
     ↓
Service
     ↓
Repository
     ↓
Model / Data Source
     ↓
HTTP Response or EJS View

Not every ticket will require every layer.

Students should preserve clear responsibilities without adding unnecessary
complexity.

Current Endpoints
GET /
GET /health
GET  /residents                    (list; ?search= searches by name)
GET  /residents/register           (registration form)
POST /residents/register           (register through T04)
GET  /residents/:id/edit           (prefilled edit form)
POST /residents/:id/update         (update through T06)
POST /residents/:id/deactivate     (soft deactivation through T07)
GET  /service-requests             (list; ?search= and ?status= through T11)
GET  /service-requests/new         (submission form)
POST /service-requests             (submit through T09)
GET  /service-requests/:id         (details through T11)
POST /service-requests/:id/start   (Pending -> In Progress through T10)
POST /service-requests/:id/complete (In Progress -> Completed through T10)
POST /service-requests/:id/cancel  (Pending/In Progress -> Cancelled through T10)

Unknown routes return HTTP 404.

Starter Scope

Do not implement resident CRUD, persistence, authentication, external APIs, or
other future functionality before the corresponding ticket is released.


---

## Step 7.6: Add `docs/developer-handbook.md`

```markdown
# JavaScript Express Developer Handbook

## Required Tools

- Node.js 24 LTS
- npm
- Git
- GitHub
- Visual Studio Code
- Web browser

## Verify the Environment

```bash
node --version
npm --version
git --version
Install Dependencies
npm ci

Run the Application:
npm start

Development watch mode:
npm run dev


Run Tests:
npm test