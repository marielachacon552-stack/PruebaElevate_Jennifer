-- Preserve existing rows and links while replacing UUID identifiers with integers.
-- The migration runner executes this entire file in a single transaction.
LOCK TABLE users, sessions, projects, project_members, tasks, comments IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE user_id_map ON COMMIT DROP AS
  SELECT id AS old_id, row_number() OVER (ORDER BY created_at, id)::integer AS new_id FROM users;
CREATE TEMP TABLE project_id_map ON COMMIT DROP AS
  SELECT id AS old_id, row_number() OVER (ORDER BY created_at, id)::integer AS new_id FROM projects;
CREATE TEMP TABLE task_id_map ON COMMIT DROP AS
  SELECT id AS old_id, row_number() OVER (ORDER BY created_at, id)::integer AS new_id FROM tasks;
CREATE UNIQUE INDEX ON user_id_map(old_id);
CREATE UNIQUE INDEX ON project_id_map(old_id);
CREATE UNIQUE INDEX ON task_id_map(old_id);

CREATE FUNCTION pg_temp.user_number(uuid) RETURNS integer LANGUAGE sql STABLE STRICT AS
  'SELECT new_id FROM pg_temp.user_id_map WHERE old_id = $1';
CREATE FUNCTION pg_temp.project_number(uuid) RETURNS integer LANGUAGE sql STABLE STRICT AS
  'SELECT new_id FROM pg_temp.project_id_map WHERE old_id = $1';
CREATE FUNCTION pg_temp.task_number(uuid) RETURNS integer LANGUAGE sql STABLE STRICT AS
  'SELECT new_id FROM pg_temp.task_id_map WHERE old_id = $1';

ALTER TABLE sessions DROP CONSTRAINT sessions_user_id_fkey;
ALTER TABLE projects DROP CONSTRAINT projects_owner_id_fkey;
ALTER TABLE project_members DROP CONSTRAINT project_members_project_id_fkey;
ALTER TABLE project_members DROP CONSTRAINT project_members_user_id_fkey;
ALTER TABLE tasks DROP CONSTRAINT tasks_project_id_fkey;
ALTER TABLE tasks DROP CONSTRAINT tasks_created_by_fkey;
ALTER TABLE tasks DROP CONSTRAINT tasks_project_id_assignee_id_fkey;
ALTER TABLE comments DROP CONSTRAINT comments_task_id_fkey;
ALTER TABLE comments DROP CONSTRAINT comments_author_id_fkey;

ALTER TABLE users ALTER COLUMN id TYPE integer USING pg_temp.user_number(id);
ALTER TABLE sessions ALTER COLUMN user_id TYPE integer USING pg_temp.user_number(user_id);
ALTER TABLE projects
  ALTER COLUMN id TYPE integer USING pg_temp.project_number(id),
  ALTER COLUMN owner_id TYPE integer USING pg_temp.user_number(owner_id);
ALTER TABLE project_members
  ALTER COLUMN project_id TYPE integer USING pg_temp.project_number(project_id),
  ALTER COLUMN user_id TYPE integer USING pg_temp.user_number(user_id);
ALTER TABLE tasks
  ALTER COLUMN id TYPE integer USING pg_temp.task_number(id),
  ALTER COLUMN project_id TYPE integer USING pg_temp.project_number(project_id),
  ALTER COLUMN assignee_id TYPE integer USING pg_temp.user_number(assignee_id),
  ALTER COLUMN created_by TYPE integer USING pg_temp.user_number(created_by);
ALTER TABLE comments
  ALTER COLUMN task_id TYPE integer USING pg_temp.task_number(task_id),
  ALTER COLUMN author_id TYPE integer USING pg_temp.user_number(author_id);

ALTER TABLE users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
ALTER TABLE projects ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
ALTER TABLE tasks ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE(max(id), 1), max(id) IS NOT NULL) FROM users;
SELECT setval(pg_get_serial_sequence('projects', 'id'), COALESCE(max(id), 1), max(id) IS NOT NULL) FROM projects;
SELECT setval(pg_get_serial_sequence('tasks', 'id'), COALESCE(max(id), 1), max(id) IS NOT NULL) FROM tasks;

ALTER TABLE sessions ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE projects ADD FOREIGN KEY (owner_id) REFERENCES users(id);
ALTER TABLE project_members ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE project_members ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE tasks ADD FOREIGN KEY (project_id, assignee_id) REFERENCES project_members(project_id, user_id);
ALTER TABLE comments ADD FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE comments ADD FOREIGN KEY (author_id) REFERENCES users(id);

DROP FUNCTION pg_temp.user_number(uuid);
DROP FUNCTION pg_temp.project_number(uuid);
DROP FUNCTION pg_temp.task_number(uuid);
