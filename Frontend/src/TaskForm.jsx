import React, { useEffect, useState } from 'react';
import { api } from './api';
import { ErrorMessage, Modal, statusNames, priorityNames } from './components';

export default function TaskForm({ task, initialStatus, members, projectId, onSaved, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [people, setPeople] = useState({ members, candidates: [] });
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [peopleError, setPeopleError] = useState('');
  const [revision, setRevision] = useState(0);
  const [assignee, setAssignee] = useState(String(task?.assignee_id || ''));
  useEffect(() => {
    const controller = new AbortController();
    setLoadingPeople(true); setPeopleError('');
    api(`/projects/${projectId}/assignees`, { signal: controller.signal })
      .then(setPeople)
      .catch(err => { if (err.name !== 'AbortError') setPeopleError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadingPeople(false); });
    return () => controller.abort();
  }, [projectId, revision]);
  const newMember = people.candidates.find(person => String(person.id) === assignee);
  async function submit(event) {
    event.preventDefault();
    if (loadingPeople || peopleError) return;
    setBusy(true); setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    body.assignee_id = assignee ? Number(assignee) : null;
    body.due_date ||= null;
    try {
      await api(`/projects/${projectId}/tasks${task ? `/${task.id}` : ''}`, { method: task ? 'PATCH' : 'POST', body });
      await onSaved();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const personOption = person => <option key={person.id} value={person.id}>{person.name} — {person.email}</option>;
  return <Modal title={task ? 'Editar tarea' : 'Nueva tarea'} subtitle="Define qué hay que hacer, quién se encargará y cuándo debe estar listo." onClose={() => !busy && onClose()}>
    <form onSubmit={submit}>
      <ErrorMessage message={error}/>
      <label>Título de la tarea<input name="title" required maxLength={180} defaultValue={task?.title} placeholder="¿Qué vamos a hacer?" autoFocus/></label>
      <label>Descripción<textarea name="description" rows={3} maxLength={10000} defaultValue={task?.description} placeholder="Añade los detalles que tu equipo necesita…"/></label>
      <div className="form-row">
        <label>Estado<select name="status" defaultValue={task?.status || initialStatus || 'todo'}>{Object.entries(statusNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Prioridad<select name="priority" defaultValue={task?.priority || 'media'}>{Object.entries(priorityNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
      <label>Persona asignada
        <select name="assignee_id" value={assignee} onChange={event => setAssignee(event.target.value)} disabled={loadingPeople || busy || !!peopleError} aria-describedby="assignee-help">
          <option value="">{loadingPeople ? 'Cargando personas…' : 'Sin asignar'}</option>
          <optgroup label="Miembros del proyecto">{people.members.map(personOption)}</optgroup>
          {people.candidates.length > 0 && <optgroup label="Otros usuarios registrados">{people.candidates.map(personOption)}</optgroup>}
        </select>
      </label>
      <p id="assignee-help" className="field-help">{newMember
        ? `Al guardar, ${newMember.name} se añadirá como miembro y tendrá acceso a este proyecto.`
        : people.candidates.length ? 'Puedes seleccionar a una persona de otro proyecto. Al asignarle esta tarea, también será miembro de este proyecto.'
        : 'Las tareas pueden asignarse a cualquier miembro del proyecto. El propietario puede incorporar más personas.'}</p>
      <ErrorMessage message={peopleError}/>
      {peopleError && <button type="button" className="btn secondary compact" onClick={() => setRevision(value => value + 1)}>Recargar personas</button>}
      <label>Fecha límite<input name="due_date" type="date" defaultValue={task?.due_date || ''}/></label>
      <div className="form-actions">
        <button type="button" className="btn secondary" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || loadingPeople || !!peopleError}>{busy ? 'Guardando…' : task ? 'Guardar cambios' : 'Crear tarea'}</button>
      </div>
    </form>
  </Modal>;
}
