# SardyxAI API Documentation

## Overview

The SardyxAI platform provides a complete REST API for multi-user LLM key management and routing.

**Base URL:** `http://localhost:3001` (development) or `https://your-domain.com` (production)

**Authentication:** Bearer token or HTTP-only session cookie

**Response Format:** JSON

## Authentication Endpoints

### Sign Up

Create a new user account.

```http
POST /api/auth/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "created_at": "2026-01-01T00:00:00Z"
  },
  "accessToken": "jwt_token",
  "session": {
    "id": "session_id",
    "expiresAt": "2026-02-01T00:00:00Z"
  }
}
```

**Errors:**
- `400` - Invalid email or password format
- `409` - Email already registered

---

### Login

Authenticate user and create session.

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  },
  "accessToken": "jwt_token",
  "session": {
    "id": "session_id",
    "expiresAt": "2026-02-01T00:00:00Z"
  }
}
```

**Errors:**
- `401` - Invalid credentials
- `400` - Missing email or password

---

### Check Authentication Status

Verify current session and get user info.

```http
GET /api/auth/status
Authorization: Bearer jwt_token
```

**Response (200 OK):**
```json
{
  "authenticated": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "created_at": "2026-01-01T00:00:00Z"
  }
}
```

**Response (401 Unauthorized):**
```json
{
  "authenticated": false,
  "error": "Session expired"
}
```

---

### Get Current User with Full Data

Retrieve authenticated user's profile, keys, and settings.

```http
GET /api/auth/me
Authorization: Bearer jwt_token
```

**Response (200 OK):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "profile": {
      "full_name": "John Doe",
      "phone": "+1234567890",
      "created_at": "2026-01-01T00:00:00Z"
    },
    "keys": [
      {
        "id": "key_id",
        "provider": "openai",
        "is_active": true,
        "created_at": "2026-01-01T00:00:00Z"
      }
    ],
    "unified_key": {
      "key": "sk-unified-...",
      "created_at": "2026-01-01T00:00:00Z"
    },
    "settings": {
      "preferred_model": "gpt-4o",
      "rate_limit": 1000
    }
  }
}
```

---

### Logout

End current session.

```http
POST /api/auth/logout
Authorization: Bearer jwt_token
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### Request Password Reset

Send password reset email.

```http
POST /api/auth/forgot-password
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Password reset email sent"
}
```

---

### Reset Password

Complete password reset with token.

```http
POST /api/auth/reset-password
Content-Type: application/json

{
  "token": "reset_token_from_email",
  "new_password": "NewPassword123"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Password updated successfully"
}
```

---

## User Data Endpoints

### List API Keys

Get all provider keys for current user.

```http
GET /api/user/keys
Authorization: Bearer jwt_token
```

**Response (200 OK):**
```json
{
  "success": true,
  "keys": [
    {
      "id": "key_id_1",
      "provider": "openai",
      "status": "active",
      "key_preview": "sk-...xxxx",
      "created_at": "2026-01-01T00:00:00Z",
      "last_used": "2026-01-05T12:00:00Z"
    },
    {
      "id": "key_id_2",
      "provider": "google",
      "status": "active",
      "key_preview": "AIza...xxxx",
      "created_at": "2026-01-02T00:00:00Z"
    }
  ]
}
```

---

### Add API Key

Store new provider key (encrypted at rest).

```http
POST /api/user/keys
Authorization: Bearer jwt_token
Content-Type: application/json

{
  "provider": "openai",
  "key": "sk-proj-..."
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "key": {
    "id": "key_id",
    "provider": "openai",
    "status": "active",
    "key_preview": "sk-...xxxx",
    "created_at": "2026-01-01T00:00:00Z"
  }
}
```

**Errors:**
- `400` - Invalid provider or key format
- `409` - Key already exists for this provider

---

### Update API Key

Update an existing provider key.

```http
PATCH /api/user/keys/:keyId
Authorization: Bearer jwt_token
Content-Type: application/json

{
  "key": "sk-new-key-..."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "key": {
    "id": "key_id",
    "provider": "openai",
    "status": "active",
    "key_preview": "sk-...yyyy",
    "updated_at": "2026-01-06T00:00:00Z"
  }
}
```

---

### Delete API Key

Remove a provider key.

```http
DELETE /api/user/keys/:keyId
Authorization: Bearer jwt_token
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Key deleted successfully"
}
```

---

### Get or Create Unified Key

Get user's unified API key for end-users, or regenerate if needed.

```http
GET /api/user/unified-key
Authorization: Bearer jwt_token
```

**Response (200 OK):**
```json
{
  "success": true,
  "unified_key": {
    "key": "sk-unified-xxxxxxxxxxxxxxxx",
    "created_at": "2026-01-01T00:00:00Z",
    "last_rotated": "2026-01-05T00:00:00Z"
  }
}
```

---

### Regenerate Unified Key

Create a new unified key (invalidates old one).

```http
POST /api/user/unified-key/regenerate
Authorization: Bearer jwt_token
```

**Response (200 OK):**
```json
{
  "success": true,
  "unified_key": {
    "key": "sk-unified-yyyyyyyyyyyyyyyy",
    "created_at": "2026-01-06T00:00:00Z"
  },
  "message": "New unified key created. Old key is no longer valid."
}
```

---

## Settings Endpoints

### Get Setting

Retrieve a user setting value.

```http
GET /api/user/settings/:key
Authorization: Bearer jwt_token
```

**Example:**
```http
GET /api/user/settings/preferred_model
```

**Response (200 OK):**
```json
{
  "success": true,
  "key": "preferred_model",
  "value": "gpt-4o"
}
```

---

### Update Setting

Save or update a user setting.

```http
PUT /api/user/settings/:key
Authorization: Bearer jwt_token
Content-Type: application/json

{
  "value": "gpt-4o"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "key": "preferred_model",
  "value": "gpt-4o"
}
```

---

## Usage Analytics Endpoints

### Get Usage Summary

Retrieve token usage for the last N days.

```http
GET /api/user/usage/summary?days=7
Authorization: Bearer jwt_token
```

**Response (200 OK):**
```json
{
  "success": true,
  "period": {
    "from": "2026-01-01T00:00:00Z",
    "to": "2026-01-08T00:00:00Z",
    "days": 7
  },
  "summary": {
    "total_requests": 1234,
    "total_input_tokens": 567890,
    "total_output_tokens": 123456,
    "total_tokens": 691346
  }
}
```

---

### Get Usage by Provider

Breakdown of usage by provider.

```http
GET /api/user/usage/by-provider?days=7
Authorization: Bearer jwt_token
```

**Response (200 OK):**
```json
{
  "success": true,
  "providers": [
    {
      "provider": "openai",
      "requests": 500,
      "input_tokens": 250000,
      "output_tokens": 50000,
      "total_tokens": 300000,
      "percentage": 43.4
    },
    {
      "provider": "google",
      "requests": 400,
      "input_tokens": 200000,
      "output_tokens": 40000,
      "total_tokens": 240000,
      "percentage": 34.7
    },
    {
      "provider": "groq",
      "requests": 334,
      "input_tokens": 117890,
      "output_tokens": 33456,
      "total_tokens": 151346,
      "percentage": 21.9
    }
  ]
}
```

---

### Get Usage by Model

Breakdown of usage by AI model.

```http
GET /api/user/usage/by-model?days=7
Authorization: Bearer jwt_token
```

**Response (200 OK):**
```json
{
  "success": true,
  "models": [
    {
      "model": "gpt-4o",
      "requests": 300,
      "input_tokens": 150000,
      "output_tokens": 30000,
      "total_tokens": 180000,
      "percentage": 26.0
    },
    {
      "model": "gemini-2.5-pro",
      "requests": 400,
      "input_tokens": 200000,
      "output_tokens": 40000,
      "total_tokens": 240000,
      "percentage": 34.7
    }
  ]
}
```

---

## LLM Routing Endpoints

### Chat Completion (OpenAI Compatible)

Route chat completions through all configured providers.

```http
POST /v1/chat/completions
Authorization: Bearer sk-unified-xxxx
Content-Type: application/json

{
  "model": "gpt-4o",
  "messages": [
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 1000
}
```

**Response (200 OK):**
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1704067200,
  "model": "gpt-4o",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "I'm doing well, thank you for asking!"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 15,
    "total_tokens": 25
  },
  "provider": "openai"
}
```

---

## Error Responses

### Standard Error Format

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

### Common Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (invalid token/session) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 409 | Conflict (resource exists) |
| 429 | Too Many Requests (rate limited) |
| 500 | Internal Server Error |

---

## Authentication Methods

### Bearer Token (Recommended)

```http
Authorization: Bearer jwt_access_token
```

### HTTP-Only Cookie (Automatic)

Session cookie `freellmapi_session` is automatically set on login.

---

## Rate Limiting

Default rate limits (configurable):
- **Per user:** 1,000 requests/minute
- **Per provider:** Respects provider free-tier limits

Rate limit headers:
```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 950
X-RateLimit-Reset: 1704067300
```

---

## Webhooks (Future)

Coming soon: Webhooks for usage events and key rotation.

---

## Client Libraries

### JavaScript/TypeScript

```typescript
import { SardyxClient } from '@sardyxai/sdk';

const client = new SardyxClient({
  apiKey: 'sk-unified-...',
  baseUrl: 'https://your-domain.com'
});

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }]
});
```

### Python

```python
from sardyxai import SardyxClient

client = SardyxClient(
    api_key='sk-unified-...',
    base_url='https://your-domain.com'
)

response = client.chat.completions.create(
    model='gpt-4o',
    messages=[{'role': 'user', 'content': 'Hello'}]
)
```

### cURL Examples

See [CURL_EXAMPLES.md](./CURL_EXAMPLES.md) for comprehensive cURL examples.

---

## Support

- **Issues:** https://github.com/yourusername/sardyxai/issues
- **Discussions:** https://github.com/yourusername/sardyxai/discussions
- **Documentation:** [QUICK_START.md](./QUICK_START.md), [PRODUCTION_DEPLOYMENT.md](./PRODUCTION_DEPLOYMENT.md)

---

**API Version:** 1.0.0  
**Last Updated:** January 6, 2026
