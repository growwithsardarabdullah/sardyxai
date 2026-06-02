export function contentToString(content) {
    if (typeof content === 'string')
        return content;
    if (content == null)
        return '';
    if (Array.isArray(content)) {
        return content
            .map((b) => (typeof b === 'string' ? b : b?.type === 'text' ? b.text : ''))
            .join('');
    }
    return '';
}
export function flattenMessageContent(messages) {
    return messages.map((m) => ({
        ...m,
        content: contentToString(m.content),
    }));
}
// True if the content array carries an image block. OpenAI's multimodal
// envelope uses `{ type: 'image_url', image_url: { url } }`; some clients send
// a bare `{ type: 'image', ... }`.
export function contentHasImage(content) {
    if (!Array.isArray(content))
        return false;
    return content.some((block) => {
        const type = block?.type;
        return type === 'image_url' || type === 'image';
    });
}
// True if any message carries an image content block. Used to route image
// requests only to vision-capable models (#118, #125).
export function messageHasImage(messages) {
    return messages.some((m) => contentHasImage(m.content));
}
//# sourceMappingURL=content.js.map