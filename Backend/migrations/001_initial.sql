CREATE TABLE users (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL CHECK (length(btrim(name)) > 0),
  email VARCHAR(254) NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  owner_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX projects_owner_idx ON projects(owner_id);
CREATE TABLE project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_idx ON project_members(user_id);
CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL CHECK (length(btrim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(5) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  priority VARCHAR(5) NOT NULL DEFAULT 'media' CHECK (priority IN ('baja', 'media', 'alta')),
  assignee_id UUID,
  due_date DATE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, assignee_id) REFERENCES project_members(project_id, user_id)
);
CREATE INDEX tasks_project_status_idx ON tasks(project_id, status);
CREATE INDEX tasks_project_priority_idx ON tasks(project_id, priority);
CREATE INDEX tasks_assignee_idx ON tasks(project_id, assignee_id);
CREATE TABLE comments (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX comments_task_idx ON comments(task_id, created_at);
