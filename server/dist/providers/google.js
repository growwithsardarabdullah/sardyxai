import { BaseProvider } from './base.js';
import { contentToString } from '../lib/content.js';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
function safeParseObject(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
        return { value: parsed };
    }
    catch {
        return { value: raw };
    }
}
function normalizeGeminiArgs(args) {
    if (typeof args === 'string')
        return args;
    return JSON.stringify(args ?? {});
}
function toGeminiFinishReason(finishReason) {
    const r = (finishReason ?? '').toUpperCase();
    if (!r)
        return 'stop';
    if (r === 'MAX_TOKENS')
        return 'length';
    if (r === 'SAFETY' || r === 'RECITATION' || r === 'BLOCKLIST' || r === 'PROHIBITED_CONTENT' || r === 'SPII') {
        return 'content_filter';
    }
    return 'stop';
}
// Google Gemini accepts only a subset of JSON Schema (~OpenAPI 3.0).
// Strip fields that opencode / other strict-JSON-Schema clients send but
// Google rejects with 400 "Unknown name '<field>'".
const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set([
    '$schema', '$id', '$ref', '$defs', '$comment',
    'definitions',
    'exclusiveMinimum', 'exclusiveMaximum',
    'patternProperties', 'unevaluatedProperties', 'unevaluatedItems',
    'if', 'then', 'else',
    'contentEncoding', 'contentMediaType', 'contentSchema',
    'dependentRequired', 'dependentSchemas',
    'additionalProperties',
]);
export function sanitizeForGemini(schema) {
    if (Array.isArray(schema)) {
        return schema.map(sanitizeForGemini);
    }
    if (schema && typeof schema === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(schema)) {
            if (GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(k))
                continue;
            out[k] = sanitizeForGemini(v);
        }
        return out;
    }
    return schema;
}
function toGeminiTools(tools) {
    if (!tools || tools.length === 0)
        return undefined;
    return [{
            functionDeclarations: tools.map(t => ({
                name: t.function.name,
                description: t.function.description,
                parameters: sanitizeForGemini(t.function.parameters),
            })),
        }];
}
function toGeminiToolConfig(toolChoice) {
    if (!toolChoice)
        return undefined;
    if (typeof toolChoice === 'string') {
        const mode = toolChoice === 'none'
            ? 'NONE'
            : toolChoice === 'required'
                ? 'ANY'
                : 'AUTO';
        return { functionCallingConfig: { mode } };
    }
    return {
        functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: [toolChoice.function.name],
        },
    };
}
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB cap on fetched/inlined images
// Pull the URL out of an OpenAI image content block. Accepts both the object
// form `{ image_url: { url } }` and the shorthand `{ image_url: '...' }`.
function extractImageUrl(block) {
    const iu = block?.image_url;
    if (typeof iu === 'string')
        return iu;
    if (iu && typeof iu.url === 'string')
        return iu.url;
    return undefined;
}
// Convert an image URL to a Gemini inlineData part. Handles base64 `data:` URLs
// directly; for `http(s)` URLs we fetch and inline because the Gemini API does
// not fetch external URLs itself. Fetching a user-supplied URL is a minor SSRF
// surface, acceptable for a single-user self-hosted proxy; we still restrict to
// http/https and cap the size. Returns null (part skipped) on any failure.
async function imageUrlToInlineData(url) {
    const dataMatch = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (dataMatch) {
        const mimeType = dataMatch[1] || 'application/octet-stream';
        const isBase64 = Boolean(dataMatch[2]);
        const payload = dataMatch[3] ?? '';
        const data = isBase64
            ? payload
            : Buffer.from(decodeURIComponent(payload)).toString('base64');
        return { mimeType, data };
    }
    if (/^https?:\/\//i.test(url)) {
        try {
            const res = await fetch(url);
            if (!res.ok)
                return null;
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES)
                return null;
            const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
            return { mimeType, data: buf.toString('base64') };
        }
        catch {
            return null;
        }
    }
    return null;
}
// Build Gemini parts for a user message: joined text first, then any images as
// inlineData. Non-array content (string/null) collapses to a single text part.
async function userContentToParts(content) {
    const parts = [];
    const text = contentToString(content);
    if (text.length > 0)
        parts.push({ text });
    if (Array.isArray(content)) {
        for (const block of content) {
            const type = block?.type;
            if (type !== 'image_url' && type !== 'image')
                continue;
            const url = extractImageUrl(block);
            if (!url)
                continue;
            const inlineData = await imageUrlToInlineData(url);
            if (inlineData)
                parts.push({ inlineData });
        }
    }
    // Gemini rejects empty `parts`; keep at least one (possibly empty) text part.
    if (parts.length === 0)
        parts.push({ text: '' });
    return parts;
}
// Translate OpenAI messages to Gemini format. Content may arrive as a string,
// null, or the OpenAI multimodal array envelope. System/assistant/tool messages
// flatten to text; user messages additionally carry images as inlineData parts.
async function toGeminiContents(messages) {
    const systemMessages = messages
        .filter(m => m.role === 'system')
        .map(m => contentToString(m.content))
        .filter(s => s.length > 0);
    const toolNameByCallId = new Map();
    for (const m of messages) {
        for (const tc of m.tool_calls ?? []) {
            toolNameByCallId.set(tc.id, tc.function.name);
        }
    }
    const contents = (await Promise.all(messages
        .filter(m => m.role !== 'system')
        .map(async (m) => {
        if (m.role === 'assistant') {
            const parts = [];
            const assistantText = contentToString(m.content);
            if (assistantText.length > 0) {
                parts.push({ text: assistantText });
            }
            for (const call of m.tool_calls ?? []) {
                parts.push({
                    thoughtSignature: call.thought_signature,
                    functionCall: {
                        id: call.id,
                        name: call.function.name,
                        args: safeParseObject(call.function.arguments),
                    },
                });
            }
            if (parts.length === 0)
                return null;
            return {
                role: 'model',
                parts,
            };
        }
        if (m.role === 'tool') {
            const toolCallId = m.tool_call_id;
            if (!toolCallId)
                return null;
            const toolName = m.name ?? toolNameByCallId.get(toolCallId) ?? 'tool';
            const response = safeParseObject(contentToString(m.content));
            return {
                role: 'user',
                parts: [{
                        functionResponse: {
                            id: toolCallId,
                            name: toolName,
                            response,
                        },
                    }],
            };
        }
        return {
            role: 'user',
            parts: await userContentToParts(m.content),
        };
    })))
        .filter((entry) => entry !== null);
    return {
        contents,
        systemInstruction: systemMessages.length > 0
            ? { parts: [{ text: systemMessages.join('\n\n') }] }
            : undefined,
    };
}
function extractToolCalls(parts) {
    const calls = [];
    if (!parts)
        return calls;
    let fallbackIndex = 0;
    for (const part of parts) {
        if (!part.functionCall?.name)
            continue;
        const id = part.functionCall.id ?? `call_${Date.now()}_${fallbackIndex++}`;
        calls.push({
            id,
            type: 'function',
            function: {
                name: part.functionCall.name,
                arguments: normalizeGeminiArgs(part.functionCall.args),
            },
            thought_signature: part.thoughtSignature,
        });
    }
    return calls;
}
function extractText(parts) {
    if (!parts)
        return null;
    const text = parts
        .map(p => p.text ?? '')
        .join('');
    return text.length > 0 ? text : null;
}
export class GoogleProvider extends BaseProvider {
    platform = 'google';
    name = 'Google AI Studio';
    async chatCompletion(apiKey, messages, modelId, options) {
        const { contents, systemInstruction } = await toGeminiContents(messages);
        const body = {
            contents,
            generationConfig: {
                temperature: options?.temperature,
                maxOutputTokens: options?.max_tokens,
                topP: options?.top_p,
            },
            tools: toGeminiTools(options?.tools),
            toolConfig: toGeminiToolConfig(options?.tool_choice),
        };
        if (systemInstruction)
            body.systemInstruction = systemInstruction;
        const url = `${API_BASE}/models/${modelId}:generateContent?key=${apiKey}`;
        const res = await this.fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(`Google API error ${res.status}: ${err.error?.message ?? res.statusText}`);
        }
        const data = await res.json();
        const candidate = data.candidates?.[0];
        const parts = candidate?.content?.parts;
        const toolCalls = extractToolCalls(parts);
        const text = extractText(parts);
        const usage = {
            prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
            completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
            total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
        };
        return {
            id: this.makeId(),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: text,
                        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
                    },
                    finish_reason: toolCalls.length > 0 ? 'tool_calls' : toGeminiFinishReason(candidate?.finishReason),
                }],
            usage,
            _routed_via: { platform: 'google', model: modelId },
        };
    }
    async *streamChatCompletion(apiKey, messages, modelId, options) {
        const { contents, systemInstruction } = await toGeminiContents(messages);
        const body = {
            contents,
            generationConfig: {
                temperature: options?.temperature,
                maxOutputTokens: options?.max_tokens,
                topP: options?.top_p,
            },
            tools: toGeminiTools(options?.tools),
            toolConfig: toGeminiToolConfig(options?.tool_choice),
        };
        if (systemInstruction)
            body.systemInstruction = systemInstruction;
        const url = `${API_BASE}/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`;
        const res = await this.fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(`Google API error ${res.status}: ${err.error?.message ?? res.statusText}`);
        }
        const reader = res.body?.getReader();
        if (!reader)
            throw new Error('No response body');
        const decoder = new TextDecoder();
        const id = this.makeId();
        let buffer = '';
        let emittedFinish = false;
        let sawToolCalls = false;
        const seenToolCallKeys = new Set();
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: '))
                    continue;
                const raw = trimmed.slice(6);
                if (raw === '[DONE]') {
                    if (!emittedFinish) {
                        emittedFinish = true;
                        yield {
                            id,
                            object: 'chat.completion.chunk',
                            created: Math.floor(Date.now() / 1000),
                            model: modelId,
                            choices: [{
                                    index: 0,
                                    delta: {},
                                    finish_reason: sawToolCalls ? 'tool_calls' : 'stop',
                                }],
                        };
                    }
                    return;
                }
                // Skip malformed SSE frames instead of aborting the whole stream.
                // Matches the defensive parse in openai-compat / cohere / cloudflare:
                // a single corrupt chunk shouldn't take down the rest of the response.
                let chunk;
                try {
                    chunk = JSON.parse(raw);
                }
                catch {
                    continue;
                }
                const candidate = chunk.candidates?.[0];
                const parts = candidate?.content?.parts ?? [];
                const text = extractText(parts);
                const toolCalls = extractToolCalls(parts).filter(call => {
                    const key = `${call.id}:${call.function.name}:${call.function.arguments}`;
                    if (seenToolCallKeys.has(key))
                        return false;
                    seenToolCallKeys.add(key);
                    return true;
                });
                if ((text && text.length > 0) || toolCalls.length > 0) {
                    sawToolCalls = sawToolCalls || toolCalls.length > 0;
                    yield {
                        id,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: modelId,
                        choices: [{
                                index: 0,
                                delta: {
                                    ...(text ? { content: text } : {}),
                                    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
                                },
                                finish_reason: null,
                            }],
                    };
                }
                if (candidate?.finishReason && !emittedFinish) {
                    emittedFinish = true;
                    yield {
                        id,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: modelId,
                        choices: [{
                                index: 0,
                                delta: {},
                                finish_reason: sawToolCalls ? 'tool_calls' : toGeminiFinishReason(candidate.finishReason),
                            }],
                    };
                    return;
                }
            }
        }
        if (!emittedFinish) {
            yield {
                id,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [{
                        index: 0,
                        delta: {},
                        finish_reason: sawToolCalls ? 'tool_calls' : 'stop',
                    }],
            };
        }
    }
    async validateKey(apiKey) {
        // Transport errors propagate — health.ts marks status='error' without
        // counting toward auto-disable. Only confirmed 401/403 disables a key.
        const res = await this.fetchWithTimeout(`${API_BASE}/models?key=${apiKey}`, { method: 'GET' }, 10000);
        return res.status !== 401 && res.status !== 403;
    }
}
//# sourceMappingURL=google.js.map