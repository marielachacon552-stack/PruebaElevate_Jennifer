import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Avatar, Empty, ErrorMessage, Icon, Modal, statusNames, priorityNames, dateLabel, isOverdue } from './components';
import { ProjectForm } from './App';
import TaskForm from './TaskForm';
import Members from './Members';

function StatusSelect({ task, busy, onStatus }) {
  return <select aria-label={`Estado de ${task.title}`} className={`status-select ${task.status}`} value={task.status} disabled={busy} onChange={event => onStatus(event.target.value)}>
    <option value="todo">Por hacer</option><option value="doing">En curso</option><option value="done">Completada</option>
  </select>;
}

function TaskCard({ task, onOpen, onStatus, onEdit, busy }) {
  return <article className={`task-card task-item ${task.status === 'done' ? 'completed-card' : ''}`}>
    <div className="task-card-top"><span className={`priority ${task.priority}`}><span/>{priorityNames[task.priority]}</span><span className="task-number">#{task.id}</span><button className="icon-btn" onClick={onEdit} title={`Editar ${task.title}`}><Icon name="edit" size={16}/></button></div>
    <button className="task-title" onClick={onOpen}>{task.title}</button>
    {task.description && <p className="task-description">{task.description}</p>}
    <div className="task-card-meta"><span className={isOverdue(task) ? 'overdue' : ''}><Icon name="calendar" size={15}/>{dateLabel(task.due_date)}{isOverdue(task) && ' · Vencida'}</span><button onClick={onOpen} title="Ver comentarios"><Icon name="message" size={15}/>{task.comment_count}</button></div>
    <div className="task-card-footer"><span className="assignee"><Avatar name={task.assignee_name || '?'} small/><span>{task.assignee_name || 'Sin asignar'}</span></span><StatusSelect task={task} busy={busy} onStatus={onStatus}/></div>
  </article>;
}

function TaskRow({ task, onOpen, onStatus, onEdit, busy }) {
  return <tr className="task-row task-item">
    <td className="task-name-cell"><button className="task-title" onClick={onOpen}>{task.title}</button><span className="row-subtitle">#{task.id}<span>·</span><Icon name="message" size={13}/>{task.comment_count} {task.comment_count === 1 ? 'comentario' : 'comentarios'}</span></td>
    <td data-label="Estado"><StatusSelect task={task} busy={busy} onStatus={onStatus}/></td>
    <td data-label="Prioridad"><span className={`priority ${task.priority}`}><span/>{priorityNames[task.priority]}</span></td>
    <td data-label="Responsable"><span className="assignee"><Avatar name={task.assignee_name || '?'} small/><span>{task.assignee_name || 'Sin asignar'}</span></span></td>
    <td data-label="Fecha límite"><span className={`row-date ${isOverdue(task) ? 'overdue' : ''}`}><Icon name="calendar" size={14}/>{dateLabel(task.due_date)}{isOverdue(task) && <span>Vencida</span>}</span></td>
    <td className="row-actions"><button className="icon-btn" title={`Editar ${task.title}`} onClick={onEdit}><Icon name="edit" size={17}/><span className="mobile-action-label">Editar tarea</span></button></td>
  </tr>;
}

export default function ProjectView({ project, user, refreshProjects, notify, onBack }) {
  const [tasks, setTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [filters, setFilters] = useState({ search: '', status: '', priority: '', assignee_id: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('list');
  const [section, setSection] = useState('tasks');
  const [showFilters, setShowFilters] = useState(false);
  const [modal, setModal] = useState(null);
  const [busyTask, setBusyTask] = useState(null);
  const [revision, setRevision] = useState(0);
  const requestVersion = useRef(0);
  const base = `/projects/${project.id}`;
  const owner = project.owner_id === user.id;
  useEffect(() => {
    const controller = new AbortController();
    const current = ++requestVersion.current;
    setLoading(true); setError('');
    const timeout = setTimeout(async () => {
      try {
        const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
        const [taskData, memberData] = await Promise.all([api(`${base}/tasks?${query}`, { signal: controller.signal }), api(`${base}/members`, { signal: controller.signal })]);
        if (current === requestVersion.current) { setTasks(taskData.tasks); setMembers(memberData.members); }
      } catch (err) { if (err.name !== 'AbortError' && current === requestVersion.current) setError(err.message); }
      finally { if (!controller.signal.aborted && current === requestVersion.current) setLoading(false); }
    }, filters.search ? 250 : 0);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [base, filters, revision]);
  async function reload() { setRevision(value => value + 1); await refreshProjects(); }
  async function status(task, value) {
    setBusyTask(task.id); setError('');
    try { await api(`${base}/tasks/${task.id}`, { method: 'PATCH', body: { status: value } }); await reload(); notify('Estado actualizado.'); }
    catch (err) { setError(err.message); }
    finally { setBusyTask(null); }
  }
  async function removeTask(task) {
    setBusyTask(task.id); setError('');
    try { await api(`${base}/tasks/${task.id}`, { method: 'DELETE' }); setModal(null); await reload(); notify('Tarea eliminada.'); }
    catch (err) { setError(err.message); }
    finally { setBusyTask(null); }
  }
  async function removeProject() {
    setBusyTask('project'); setError('');
    try { await api(base, { method: 'DELETE' }); await refreshProjects(); onBack(); notify('Proyecto eliminado.'); }
    catch (err) { setError(err.message); }
    finally { setBusyTask(null); }
  }
  const filter = (key, value) => setFilters(previous => ({ ...previous, [key]: value }));
  const clearFilters = () => setFilters({ search: '', status: '', priority: '', assignee_id: '' });
  const hasFilters = Object.values(filters).some(Boolean);
  const filterCount = [filters.status, filters.priority, filters.assignee_id].filter(Boolean).length;
  const taskProps = task => ({ task, busy: Boolean(busyTask), onOpen: () => setModal({ type: 'detail', task }), onEdit: () => setModal({ type: 'task', task }), onStatus: value => status(task, value) });
  const progress = project.task_count ? Math.round(project.done_count / project.task_count * 100) : 0;

  return <main className="workspace project-workspace organized-project">
    <button className="back-link" onClick={onBack}><Icon name="back" size={15}/>Todos los proyectos</button>
    <header className="page-heading project-heading">
      <div><span className="project-role">{owner ? 'Eres propietario' : 'Eres miembro'}</span><h1>{project.name}</h1><p className="project-intro">{project.description || 'Organiza las tareas y colabora con las personas de este proyecto.'}</p></div>
      <button className="btn primary" onClick={() => setModal({ type: 'task' })}><Icon name="plus" size={18}/>Nueva tarea</button>
    </header>
    <section className="project-overview" aria-label="Resumen del proyecto">
      <div className="overview-progress"><div><span>Progreso del proyecto</span><strong>{progress}%</strong></div><progress aria-label="Progreso del proyecto" max={project.task_count || 1} value={project.done_count}/><span>{project.done_count} de {project.task_count} tareas completadas</span></div>
      <div className="overview-number"><strong>{project.task_count - project.done_count}</strong><span>Por completar</span></div>
      <div className="overview-number"><strong>{project.done_count}</strong><span>Completadas</span></div>
      <button className="team-button overview-team" onClick={() => setSection('team')}><Icon name="users" size={21}/><span><strong>{project.member_count} {project.member_count === 1 ? 'miembro' : 'miembros'}</strong><span>Ver equipo <Icon name="arrow" size={13}/></span></span></button>
    </section>
    <nav className="project-sections" aria-label="Secciones del proyecto">
      <button id="project-tab-tasks" aria-current={section === 'tasks' ? 'page' : undefined} onClick={() => setSection('tasks')}><Icon name="list" size={18}/>Tareas <span>{project.task_count}</span></button>
      <button id="project-tab-team" aria-current={section === 'team' ? 'page' : undefined} onClick={() => setSection('team')}><Icon name="users" size={18}/>Equipo <span>{project.member_count}</span></button>
      {owner && <button id="project-tab-settings" aria-current={section === 'settings' ? 'page' : undefined} onClick={() => setSection('settings')}><Icon name="settings" size={18}/>Ajustes</button>}
    </nav>

    {section === 'tasks' && <section className="tasks-panel" aria-labelledby="tasks-title">
      <div className="section-heading"><div><h2 id="tasks-title">Tareas del proyecto</h2><p>Abre una tarea para ver los detalles y los comentarios.</p></div><div className="view-switch" aria-label="Vista de tareas"><button className={mode === 'list' ? 'active' : ''} aria-pressed={mode === 'list'} onClick={() => setMode('list')}><Icon name="list" size={17}/>Lista</button><button className={mode === 'board' ? 'active' : ''} aria-pressed={mode === 'board'} onClick={() => setMode('board')}><Icon name="board" size={17}/>Tablero</button></div></div>
      <div className="task-tools">
        <label className="search-box"><Icon name="search" size={18}/><input aria-label="Buscar tareas" value={filters.search} onChange={event => filter('search', event.target.value)} placeholder="Buscar por título o descripción"/></label>
        <button className={`btn secondary filter-toggle ${filterCount ? 'has-filters' : ''}`} aria-expanded={showFilters} aria-controls="task-filters" onClick={() => setShowFilters(value => !value)}><Icon name="filter" size={17}/>Filtros{filterCount > 0 && <span className="count-badge">{filterCount}</span>}</button>
        <button className={`btn secondary ${filters.assignee_id === String(user.id) ? 'has-filters' : ''}`} aria-pressed={filters.assignee_id === String(user.id)} onClick={() => filter('assignee_id', filters.assignee_id === String(user.id) ? '' : String(user.id))}>Asignadas a mí</button>
      </div>
      {showFilters && <div className="labeled-filters" id="task-filters">
        <label>Estado<select aria-label="Filtrar por estado" value={filters.status} onChange={event => filter('status', event.target.value)}><option value="">Todos los estados</option>{Object.entries(statusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Prioridad<select aria-label="Filtrar por prioridad" value={filters.priority} onChange={event => filter('priority', event.target.value)}><option value="">Todas las prioridades</option>{Object.entries(priorityNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Responsable<select aria-label="Filtrar por persona" value={filters.assignee_id} onChange={event => filter('assignee_id', event.target.value)}><option value="">Todas las personas</option><option value="unassigned">Sin asignar</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      </div>}
      <div className="results-caption" role="status"><span>{loading ? 'Cargando tareas…' : `Mostrando ${tasks.length} de ${project.task_count} ${project.task_count === 1 ? 'tarea' : 'tareas'}`}</span>{hasFilters && <button className="clear-filters" onClick={clearFilters}>Limpiar</button>}</div>
      <ErrorMessage message={error}/>{error && <button className="btn secondary" onClick={() => setRevision(value => value + 1)}>Volver a cargar tareas</button>}
      {loading ? <p className="loading">Cargando tareas…</p> : error ? null : !tasks.length ? <Empty title={hasFilters ? 'Sin tareas con estos filtros' : 'Este proyecto aún no tiene tareas'} action={hasFilters ? <button className="btn secondary" onClick={clearFilters}>Ver todas las tareas</button> : <button className="btn primary" onClick={() => setModal({ type: 'task' })}><Icon name="plus" size={18}/>Crear primera tarea</button>}>{hasFilters ? 'Cambia los filtros o límpialos para volver a ver todas las tareas.' : 'Crea una tarea, elige quién se encargará y define una fecha límite.'}</Empty>
        : mode === 'list' ? <div className="task-table-wrap"><table className="task-table"><caption className="sr-only">Tareas del proyecto {project.name}</caption><thead><tr><th scope="col">Tarea</th><th scope="col">Estado</th><th scope="col">Prioridad</th><th scope="col">Responsable</th><th scope="col">Fecha límite</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead><tbody>{tasks.map(task => <TaskRow key={task.id} {...taskProps(task)}/>)}</tbody></table></div>
        : <div className="board">{Object.entries(statusNames).filter(([key]) => !filters.status || key === filters.status).map(([key, label]) => <section className={`board-column ${key}`} key={key}><div className="column-heading"><h3><span className="status-dot"/>{label}<span className="column-count">{tasks.filter(task => task.status === key).length}</span></h3><button className="icon-btn" title={`Crear tarea: ${label}`} onClick={() => setModal({ type: 'task', status: key })}><Icon name="plus" size={18}/></button></div><div className="column-tasks">{tasks.filter(task => task.status === key).map(task => <TaskCard key={task.id} {...taskProps(task)}/>)}{!tasks.some(task => task.status === key) && <p className="column-empty">No hay tareas en este estado.</p>}</div><button className="add-task" onClick={() => setModal({ type: 'task', status: key })}><Icon name="plus" size={16}/>Añadir tarea</button></section>)}</div>}
    </section>}

    {section === 'team' && <Members embedded project={project} user={user} onChanged={reload}/>}
    {section === 'settings' && owner && <section className="settings-panel" aria-labelledby="settings-title">
      <div className="section-heading"><div><h2 id="settings-title">Ajustes del proyecto</h2><p>Solo el propietario puede modificar estos datos.</p></div></div>
      <div className="settings-card"><div><h3>Información del proyecto</h3><p>Actualiza el nombre y la descripción que ve tu equipo.</p><dl><dt>Nombre</dt><dd>{project.name}</dd><dt>Descripción</dt><dd>{project.description || 'Sin descripción'}</dd></dl></div><button className="btn secondary" onClick={() => setModal({ type: 'project' })}><Icon name="edit" size={17}/>Editar proyecto</button></div>
      <div className="settings-card danger-zone"><div><h3>Eliminar proyecto</h3><p>Se eliminarán sus tareas y comentarios para todos los miembros. Esta acción no se puede deshacer.</p></div><button className="btn danger-outline" onClick={() => setModal({ type: 'delete-project' })} disabled={Boolean(busyTask)}><Icon name="trash" size={17}/>Eliminar proyecto</button></div>
    </section>}

    {modal?.type === 'task' && <TaskForm task={modal.task} initialStatus={modal.status} members={members} projectId={project.id} onClose={() => setModal(null)} onSaved={async () => { await reload(); setModal(null); setSection('tasks'); notify(modal.task ? 'Cambios guardados.' : 'Nueva tarea creada.'); }}/>} 
    {modal?.type === 'detail' && <TaskDetail task={modal.task} projectId={project.id} onClose={() => setModal(null)} onEdit={() => setModal({ type: 'task', task: modal.task })} onDelete={() => setModal({ type: 'delete-task', task: modal.task })} onComment={() => setRevision(value => value + 1)}/>}
    {modal?.type === 'project' && <ProjectForm project={project} onClose={() => setModal(null)} onSaved={async () => { await refreshProjects(); setModal(null); notify('Proyecto actualizado.'); }}/>} 
    {(modal?.type === 'delete-project' || modal?.type === 'delete-task') && <Modal title={modal.type === 'delete-project' ? '¿Eliminar este proyecto?' : '¿Eliminar esta tarea?'} onClose={() => !busyTask && setModal(null)}><p className="confirm-description">{modal.type === 'delete-project' ? `Se eliminará «${project.name}» con todas sus tareas y comentarios.` : `Se eliminará «${modal.task.title}» y sus comentarios.`} Esta acción no se puede deshacer.</p><ErrorMessage message={error}/><div className="form-actions"><button className="btn secondary" onClick={() => setModal(null)} disabled={Boolean(busyTask)}>Cancelar</button><button className="btn danger" disabled={Boolean(busyTask)} onClick={() => modal.type === 'delete-project' ? removeProject() : removeTask(modal.task)}>{busyTask ? 'Eliminando…' : modal.type === 'delete-project' ? 'Eliminar proyecto' : 'Eliminar tarea'}</button></div></Modal>}
  </main>;
}


function TaskDetail({ task, projectId, onClose, onComment, onEdit, onDelete }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState('');
  const base = `/projects/${projectId}/tasks/${task.id}/comments`;
  const load = useCallback(async signal => {
    setLoading(true); setError('');
    try { const data = await api(base, { signal }); setComments(data.comments); }
    catch (err) { if (err.name !== 'AbortError') setError(err.message); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [base]);
  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);
  async function send(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const { comment } = await api(base, { method: 'POST', body: { body } }); setComments(list => [...list, comment]); setBody(''); onComment(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal title={task.title} subtitle="Cada detalle y cada conversación, en su lugar." onClose={() => !busy && onClose()} wide><div className="detail-meta"><span className={`status-label ${task.status}`}>{statusNames[task.status]}</span><span className={`priority ${task.priority}`}>Prioridad {priorityNames[task.priority].toLowerCase()}</span><span><Icon name="calendar" size={16}/>{dateLabel(task.due_date)}</span><span><Avatar name={task.assignee_name || '?'} small/>{task.assignee_name || 'Sin asignar'}</span></div><p className="detail-description">{task.description || 'Esta tarea todavía no tiene descripción.'}</p><button className="btn secondary compact" onClick={onEdit} disabled={busy}><Icon name="edit" size={16}/>Editar tarea</button><button className="btn compact danger-text detail-delete" onClick={onDelete} disabled={busy}><Icon name="trash" size={16}/>Eliminar tarea</button><section className="comments"><h3>Conversación <span className="count-badge">{comments.length}</span></h3><ErrorMessage message={error}/>{loading ? <p className="muted">Cargando comentarios…</p> : comments.length ? <div className="comment-list">{comments.map(c => <article className="comment" key={c.id}><Avatar name={c.author_name} small/><div><div className="comment-heading"><strong>{c.author_name}</strong><time>{new Date(c.created_at).toLocaleString('es-HN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></div><p>{c.body}</p></div></article>)}</div> : <p className="comment-empty">Una pregunta, una idea, una actualización.<br/>Inicia la conversación con tu equipo.</p>}{error && <button className="btn secondary compact" onClick={() => load()}>Recargar comentarios</button>}<form onSubmit={send}><label className="sr-only" htmlFor="comment-body">Escribe un comentario</label><textarea id="comment-body" value={body} onChange={e => setBody(e.target.value)} placeholder="Comparte algo con tu equipo…" required maxLength={5000} rows={3}/><div className="form-actions"><button className="btn primary compact" disabled={busy || !body.trim() || loading}>{busy ? 'Enviando…' : 'Publicar comentario'}<Icon name="arrow" size={15}/></button></div></form></section></Modal>;
}


