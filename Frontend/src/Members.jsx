import React, { useEffect, useState } from 'react';
import { api } from './api';
import { Avatar, ErrorMessage, Icon, Modal } from './components';

export default function Members({ project, user, onClose, onChanged, embedded = false }) {
  const [people, setPeople] = useState({ members: [], candidates: [] });
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const owner = project.owner_id === user.id;
  const base = `/projects/${project.id}`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    api(`${base}/assignees`, { signal: controller.signal }).then(setPeople)
      .catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [base, revision]);
  async function refresh() {
    const data = await api(`${base}/assignees`);
    setPeople(data);
    await onChanged();
  }
  async function add(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api(`${base}/members`, { method: 'POST', body: { email } }); setEmail(''); await refresh(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function remove(member) {
    if (!window.confirm(`¿Quitar a ${member.name} del proyecto? Sus tareas quedarán sin asignar.`)) return;
    setBusy(true); setError('');
    try { await api(`${base}/members/${member.id}`, { method: 'DELETE' }); await refresh(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  const Container = embedded ? 'section' : Modal;
  const containerProps = embedded ? { className: 'team-panel', 'aria-labelledby': 'team-title' } : { title: 'Equipo del proyecto', subtitle: 'Una persona puede formar parte de varios proyectos.', onClose: () => !busy && onClose() };
  return <Container {...containerProps}>
    {embedded && <div className="section-heading"><div><h2 id="team-title">Equipo del proyecto</h2><p>Estas personas pueden acceder a las tareas y colaborar en este proyecto.</p></div></div>}
    <ErrorMessage message={error}/>
    {error && <button className="btn secondary compact" disabled={busy} onClick={() => setRevision(value => value + 1)}>Recargar personas</button>}
    <div className="team-layout">
    {owner && <form onSubmit={add} className="add-member-form">
      <h3>Añadir al equipo</h3>
      <label>Añadir una persona registrada
        <select name="member_email" value={email} onChange={event => setEmail(event.target.value)} required disabled={loading || busy}>
          <option value="">{loading ? 'Cargando personas…' : 'Selecciona una persona'}</option>
          {people.candidates.map(person => <option key={person.id} value={person.email}>{person.name} — {person.email}</option>)}
        </select>
      </label>
      <p className="field-help">{!loading && !error && !people.candidates.length ? 'Todos los usuarios registrados ya pertenecen a este proyecto.' : 'Puedes añadir personas aunque ya pertenezcan a otros proyectos.'}</p>
      <button className="btn primary compact" disabled={busy || loading || !email}><Icon name="plus" size={16}/>{busy ? 'Guardando…' : 'Añadir al proyecto'}</button>
    </form>}
    <div className="members-list"><h3>Miembros actuales <span className="count-badge">{people.members.length}</span></h3>{loading ? <p>Cargando equipo…</p> : people.members.map(member => <div className="member" key={member.id}>
      <Avatar name={member.name}/>
      <div><strong>{member.name}{member.id === user.id ? ' (tú)' : ''}</strong><span>{member.email}</span></div>
      {member.id === project.owner_id ? <span className="project-role">Propietario</span> : <><span className="project-role">Miembro</span>{owner && <button className="icon-btn danger-text" title={`Quitar a ${member.name}`} disabled={busy} onClick={() => remove(member)}><Icon name="close" size={17}/></button>}</>}
    </div>)}</div>
    </div>
  </Container>;
}
