# SardyxAI - cURL Examples

Quick reference for testing the SardyxAI API with cURL.

Replace `http://localhost:3001` with your production domain.

---

## Authentication

### Sign Up

```bash
curl -X POST http://localhost:3001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePassword123"
  }'
```

**Save the response token:**
```bash
export TOKEN="your_jwt_token_here"
```

### Login

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePassword123"
  }'
```

### Check Status

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/auth/status
```

### Get Current User

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/auth/me
```

### Logout

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/auth/logout
```

---

## API Keys Management

### List All Keys

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/user/keys
```

### Add OpenAI Key

```bash
curl -X POST http://localhost:3001/api/user/keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "key": "sk-proj-your-real-key-here"
  }'
```

### Add Google Key

```bash
curl -X POST http://localhost:3001/api/user/keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "google",
    "key": "AIza...your-real-key-here"
  }'
```

### Add Groq Key

```bash
curl -X POST http://localhost:3001/api/user/keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "groq",
    "key": "gsk_...your-real-key-here"
  }'
```

### Get Key Details

```bash
# First get key ID from list
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/user/keys
```

### Update Key

```bash
curl -X PATCH http://localhost:3001/api/user/keys/KEY_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "sk-new-key-here"
  }'
```

### Delete Key

```bash
curl -X DELETE http://localhost:3001/api/user/keys/KEY_ID \
  -H "Authorization: Bearer $TOKEN"
```

---

## Unified API Key

### Get Unified Key

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/user/unified-key
```

**Save it for later use:**
```bash
export UNIFIED_KEY="sk-unified-..."
```

### Regenerate Unified Key

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/user/unified-key/regenerate
```

---

## User Settings

### Get Setting

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/user/settings/preferred_model
```

### Update Setting

```bash
curl -X PUT http://localhost:3001/api/user/settings/preferred_model \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "value": "gpt-4o"
  }'
```

### Common Settings

```bash
# Set preferred model
curl -X PUT http://localhost:3001/api/user/settings/preferred_model \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "gpt-4o"}'

# Set rate limit (tokens/minute)
curl -X PUT http://localhost:3001/api/user/settings/rate_limit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": 10000}'

# Set temperature (0-2)
curl -X PUT http://localhost:3001/api/user/settings/temperature \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": 0.7}'
```

---

## Usage Analytics

### Get Weekly Usage Summary

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/user/usage/summary?days=7"
```

### Get Monthly Usage Summary

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/user/usage/summary?days=30"
```

### Usage by Provider (Last 7 Days)

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/user/usage/by-provider?days=7"
```

### Usage by Model (Last 7 Days)

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/user/usage/by-model?days=7"
```

### Usage by Date (Last 30 Days)

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/user/usage/by-date?days=30"
```

---

## LLM Chat Completions

### Simple Chat

```bash
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer $UNIFIED_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "user",
        "content": "What is 2+2?"
      }
    ]
  }'
```

### With Temperature and Max Tokens

```bash
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer $UNIFIED_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant."
      },
      {
        "role": "user",
        "content": "Explain quantum computing"
      }
    ],
    "temperature": 0.7,
    "max_tokens": 1000
  }'
```

### Multi-Turn Conversation

```bash
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer $UNIFIED_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "user",
        "content": "What is Python?"
      },
      {
        "role": "assistant",
        "content": "Python is a high-level programming language..."
      },
      {
        "role": "user",
        "content": "How do I install it?"
      }
    ]
  }'
```

### Using Groq (Fast)

```bash
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer $UNIFIED_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama-3.3-70b",
    "messages": [
      {
        "role": "user",
        "content": "Hello!"
      }
    ]
  }'
```

### Using Google Gemini

```bash
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer $UNIFIED_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [
      {
        "role": "user",
        "content": "Analyze this text: Lorem ipsum..."
      }
    ]
  }'
```

### Stream Mode (if supported)

```bash
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer $UNIFIED_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {
        "role": "user",
        "content": "Write a poem"
      }
    ],
    "stream": true
  }'
```

---

## Advanced Examples

### Complete Flow: Sign Up → Add Key → Make Request

```bash
#!/bin/bash

# 1. Sign up
SIGNUP=$(curl -s -X POST http://localhost:3001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "SecurePass123"
  }')

TOKEN=$(echo $SIGNUP | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)
echo "Token: $TOKEN"

# 2. Add API key
curl -s -X POST http://localhost:3001/api/user/keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "key": "sk-proj-your-key"
  }'

# 3. Get unified key
UNIFIED=$(curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/user/unified-key)

UNIFIED_KEY=$(echo $UNIFIED | grep -o '"key":"[^"]*' | cut -d'"' -f4)
echo "Unified Key: $UNIFIED_KEY"

# 4. Make API call
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "Authorization: Bearer $UNIFIED_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Get Usage Report and Export as JSON

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/user/usage/summary?days=30" | \
  jq '.' > usage_report.json

cat usage_report.json
```

### Monitor All Providers' Daily Quota

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/user/usage/by-provider?days=1" | \
  jq '.providers[] | {provider: .provider, tokens_used: .total_tokens}'
```

---

## Error Handling

### Check Response Status

```bash
# Check if request succeeded
curl -w "\nHTTP Status: %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/auth/me

# HTTP 200 = Success
# HTTP 401 = Unauthorized (bad token)
# HTTP 403 = Forbidden (no permission)
# HTTP 429 = Rate limited
# HTTP 500 = Server error
```

### Pretty Print JSON Response

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/auth/me | jq '.'
```

### Save Response to File

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/user/keys > keys.json
```

---

## Tips & Tricks

### Set Up Bash Variables

```bash
# Save tokens to environment
export API_URL="http://localhost:3001"
export EMAIL="test@example.com"
export PASSWORD="SecurePass123"
export TOKEN="your_token"
export UNIFIED_KEY="sk-unified-..."
```

### Reuse in Commands

```bash
curl -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$EMAIL\",
    \"password\": \"$PASSWORD\"
  }"
```

### Pretty Print All JSON Responses

```bash
alias curl-json='curl -s | jq'

curl-json -H "Authorization: Bearer $TOKEN" \
  $API_URL/api/auth/me
```

### Test Authentication

```bash
# Valid token
curl -I -H "Authorization: Bearer $TOKEN" \
  $API_URL/api/auth/status

# Invalid token
curl -I -H "Authorization: Bearer invalid" \
  $API_URL/api/auth/status

# No token
curl -I $API_URL/api/auth/status
```

---

## Troubleshooting

### "Connection refused"
- Backend not running: `cd server && npm run dev`

### "Invalid token"
- Token expired: Re-login to get new token
- Token format wrong: Should start with "eyJ"

### "Unauthorized"
- Missing Authorization header
- Header format: `Authorization: Bearer <token>`

### "User not found"
- Create account first with `/api/auth/signup`
- Check email is correct

### "Too many requests"
- You've hit rate limit
- Wait a minute before retrying
- Check rate limit in headers

---

**Last Updated:** January 6, 2026
