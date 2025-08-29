import crypto from 'crypto';
import { createRequire } from 'module';

// Try to load external HASH_TO_URLS map. If missing, default to empty.
// Prefer ESM dynamic import; fall back to require if needed.
let HASH_TO_URLS = {};
try {
  const mod = await import('./hashWebhookMap.js');
  HASH_TO_URLS = (mod && (mod.default || mod.HASH_TO_URLS || mod)) || {};
} catch {
  try {
    const require = createRequire(import.meta.url);
    const mod = require('./hashWebhookMap.js');
    HASH_TO_URLS = (mod && (mod.default || mod.HASH_TO_URLS || mod)) || {};
  } catch {
    HASH_TO_URLS = {};
  }
}

// Hash the provided id with SHA-256 (hex)
function hashId(id) {
  return crypto.createHash('sha256').update(String(id)).digest('hex');
}

// Returns a concrete webhook URL for the given id and event type.
// Supported eventType values: 'dataSuccess' | 'imagesSuccess' | 'warning' | 'error'
// Backward compatibility: 'dataError' | 'imagesError' will map to 'error'
export function getWebhookUrl(id, eventType) {
  if (!id || typeof id !== 'string') return null;

  const hash = hashId(id);
  // Try hashed key first, then raw id as a fallback for flexibility
  const entry = HASH_TO_URLS[hash] || HASH_TO_URLS[id];

  if (!entry) {
    console.warn(`[diagnostics] No mapping entry for id. id=${id} hash=${hash} mapSize=${Object.keys(HASH_TO_URLS).length}`);
    return null;
  }

  // Normalize legacy error types to consolidated 'error'
  let normalizedType = eventType;
  if (eventType === 'dataError' || eventType === 'imagesError') {
    normalizedType = 'error';
  }

  // Resolve template by type
  let template;
  if (normalizedType === 'error') {
    template = entry.error || entry.dataError || entry.imagesError;
  } else if (normalizedType === 'warning') {
    template = entry.warning || entry.error || entry.dataError || entry.imagesError;
  } else {
    // dataSuccess or imagesSuccess
    template = entry[normalizedType];
  }

  if (!template) {
    const available = Object.keys(entry || {});
    console.warn(`[diagnostics] No webhook URL mapped for type=${normalizedType}. id=${id} hash=${hash} availableTypes=${available.join(',')}`);
    return null;
  }

  return template.includes('{id}') ? template.replace('{id}', id) : template;
}