// ============================================================================
// Lightweight JSON Schema Validator — No external dependencies
// Life Command Center — Copilot Integration Layer
//
// Validates action inputs against JSON Schema (draft-07 subset).
// Supports: type, required, enum, format, minimum, maximum, properties,
//           items, const, minLength, maxLength.
//
// This is intentionally minimal — we don't need $ref, allOf, oneOf,
// patternProperties, etc. for action input validation. If schemas grow
// more complex, swap in ajv.
// ============================================================================

/**
 * Validate a value against a JSON Schema.
 *
 * @param {*} value - The value to validate
 * @param {object} schema - JSON Schema object
 * @param {string} [path=''] - Current path (for error messages)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSchema(value, schema, path = '') {
  const errors = [];

  if (!schema || typeof schema !== 'object') {
    return { valid: true, errors: [] };
  }

  // Type check
  if (schema.type) {
    const actualType = getJsonType(value);
    if (schema.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`${path || 'value'}: expected integer, got ${actualType}`);
      }
    } else if (actualType !== schema.type) {
      // Allow null for optional fields
      if (value !== null && value !== undefined) {
        errors.push(`${path || 'value'}: expected ${schema.type}, got ${actualType}`);
      }
    }
  }

  // Enum check
  if (schema.enum && value != null) {
    if (!schema.enum.includes(value)) {
      errors.push(`${path || 'value'}: must be one of [${schema.enum.join(', ')}], got "${value}"`);
    }
  }

  // Const check
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path || 'value'}: must be "${schema.const}"`);
  }

  // String constraints
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push(`${path || 'value'}: must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      errors.push(`${path || 'value'}: must be at most ${schema.maxLength} characters`);
    }
    // Format check (lightweight — just validates shape, not full RFC compliance)
    if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      errors.push(`${path || 'value'}: invalid UUID format`);
    }
    if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      errors.push(`${path || 'value'}: invalid date format (expected YYYY-MM-DD)`);
    }
    if (schema.format === 'date-time' && isNaN(Date.parse(value))) {
      errors.push(`${path || 'value'}: invalid date-time format`);
    }
  }

  // Number constraints
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) {
      errors.push(`${path || 'value'}: must be >= ${schema.minimum}`);
    }
    if (schema.maximum != null && value > schema.maximum) {
      errors.push(`${path || 'value'}: must be <= ${schema.maximum}`);
    }
  }

  // Object: validate properties and required
  if (schema.type === 'object' && value != null && typeof value === 'object' && !Array.isArray(value)) {
    // Required fields
    if (schema.required) {
      for (const key of schema.required) {
        if (value[key] === undefined || value[key] === null) {
          errors.push(`${path ? path + '.' : ''}${key}: required`);
        }
      }
    }

    // Property schemas
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (value[key] !== undefined && value[key] !== null) {
          const propResult = validateSchema(value[key], propSchema, `${path ? path + '.' : ''}${key}`);
          errors.push(...propResult.errors);
        }
      }
    }
  }

  // Array: validate items
  if (schema.type === 'array' && Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) {
      const itemResult = validateSchema(value[i], schema.items, `${path}[${i}]`);
      errors.push(...itemResult.errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate copilot action inputs against the registered schema.
 * Returns a clean result suitable for the gateway response.
 *
 * @param {string} actionId - The action name
 * @param {object} params - The input params from the copilot request
 * @param {object} schemas - The ACTION_SCHEMAS map
 * @returns {{ valid: boolean, errors?: string[] }}
 */
export function validateActionInput(actionId, params, schemas) {
  const schema = schemas[actionId];

  // No schema defined — allow through (backward compatible)
  if (!schema || !schema.inputs) {
    return { valid: true };
  }

  // Strip internal flags before validation
  const cleanParams = { ...params };
  delete cleanParams._confirmed;
  delete cleanParams._surface;

  const result = validateSchema(cleanParams, schema.inputs);
  return result;
}

// ============================================================================
// HELPERS
// ============================================================================

function getJsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'string', 'number', 'boolean', 'object', 'undefined'
}
