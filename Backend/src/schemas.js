const id = { type: 'integer', minimum: 1, maximum: 2147483647 };
// URL parameters remain strings; JSON request/response IDs are numbers.
const urlId = { type: 'string', pattern: '^[1-9][0-9]{0,9}$', maxLength: 10 };
const text = (maxLength, minLength = 0) => ({ type: 'string', minLength, maxLength, ...(minLength ? { pattern: '\\S' } : {}) });
const object = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const params = (...keys) => object(Object.fromEntries(keys.map(key => [key, urlId])), keys);
const email = { type: 'string', format: 'email', maxLength: 254 };
const password = { type: 'string', minLength: 8, maxLength: 128 };
const project = object({ name: text(120, 1), description: text(5000) }, ['name']);
const taskFields = {
  title: text(180, 1), description: text(10000),
  status: { type: 'string', enum: ['todo', 'doing', 'done'] },
  priority: { type: 'string', enum: ['baja', 'media', 'alta'] },
  assignee_id: { ...id, nullable: true },
  due_date: { type: 'string', format: 'date', nullable: true },
};
module.exports = { id, urlId, text, object, params, email, password, project, taskFields };
