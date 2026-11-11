export class AIRichError extends Error {
	constructor(message, code, meta = {}) {
		super(message);
		this.name = 'AIRichError';
		this.code = code;
		Object.assign(this, meta);
	}
}

export class ItemNotFoundError extends AIRichError {
	constructor(id, availableIds = []) {
		super(`Item id "${id}" not found${availableIds.length ? ` (available: ${availableIds.join(', ')})` : ' (no items have an id yet)'}`, 'ITEM_NOT_FOUND', { id, availableIds });
		this.name = 'ItemNotFoundError';
	}
}

export class DuplicateIdError extends AIRichError {
	constructor(id) {
		super(`Item id "${id}" already exists`, 'DUPLICATE_ID', { id });
		this.name = 'DuplicateIdError';
	}
}

export class InvalidTargetError extends AIRichError {
	constructor(message, meta = {}) {
		super(message, 'INVALID_TARGET', meta);
		this.name = 'InvalidTargetError';
	}
}

export class ContentValidationError extends AIRichError {
	constructor(message, meta = {}) {
		super(message, 'CONTENT_VALIDATION', meta);
		this.name = 'ContentValidationError';
	}
}
