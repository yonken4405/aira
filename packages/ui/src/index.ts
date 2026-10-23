/**
 * `@aira/ui` - shared, platform-neutral core of AIRA.
 * Importable from both apps (Next.js and React Native) - keep it DOM-free.
 * Web-only components live under `@aira/ui/web`.
 *
 * NOTE (PRODUCT.md §2): no voice/STT, no chat, no LLM code may ever be added here.
 */

export * from './categories';
export * from './payload';
export * from './mesh';
export * from './outbox';
export * from './navigation';
export * from './i18n';
export * from './citizen/deviceKey';
export * from './citizen/medicalBounds';
export * from './citizen/cookieJar';
export * from './citizen/errorToCopyKey';
export * from './citizen/sessionRestore';
export * from './citizen/deviceAuthSequence';
export * from './citizen/validateMedicalDraft';
export { cn } from './cn';
