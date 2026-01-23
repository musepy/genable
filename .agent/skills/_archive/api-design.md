---
description: REST API design standards following HTTP semantics and best practices
---

# API Design

> **Purpose**: Ensure consistent, RESTful API design across all endpoints.

---

## Core Rules

### Identifiers
Use stable, readable, **ASCII identifiers** for:
- URL paths and parameters
- Response keys and types
- Error codes and messages

### HTTP Semantics
Follow proper HTTP methods and status codes:

| Method | Usage |
|--------|-------|
| GET | Read resources |
| POST | Create resources |
| PUT | Replace resources |
| PATCH | Partial update |
| DELETE | Remove resources |

### Status Codes
| Code | Usage |
|------|-------|
| 2xx | Success |
| 4xx | Client error |
| 5xx | Server error |

**Important**: Avoid overusing `200 OK` for errors

---

## URL Conventions
1. Use kebab-case for URLs: `/user-profiles`
2. Use camelCase for JSON keys: `{ "userName": "..." }`
3. Version APIs: `/v1/users`

---

## Examples

### Good API Design
```
GET    /api/v1/users           # List users
GET    /api/v1/users/:id       # Get single user
POST   /api/v1/users           # Create user
PATCH  /api/v1/users/:id       # Update user
DELETE /api/v1/users/:id       # Delete user
```

### Good Error Response
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "field": "email"
  }
}
```
Status: `400 Bad Request`

### Avoid
```json
{
  "success": false,
  "error": "Something went wrong"
}
```
Status: `200 OK` (Wrong! Should be 4xx)
