// Kept free of imports so storage and other low-level modules can throw it without opening the database.
export class AppError extends Error { constructor(message:string,public status=400){super(message);this.name='AppError';} }
/** Shape check that survives duplicated module copies, where instanceof can fail. StorageError extends AppError. */
export function isAppError(error:unknown):error is AppError{const e=error as {name?:unknown;status?:unknown}|null;return !!e&&typeof e==='object'&&(e.name==='AppError'||e.name==='StorageError')&&typeof e.status==='number';}
