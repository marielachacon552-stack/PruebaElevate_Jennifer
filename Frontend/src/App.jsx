import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { Avatar, Empty, ErrorMessage, Icon, Logo, Modal } from './components';
import ProjectView from './ProjectView';
import ProjectOverview from './ProjectOverview';

function Auth({ onAuthenticated }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    values.email = values.email.trim();
    try { const { user } = await api(`/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: values }); onAuthenticated(user); }
    catch (err) { setError(err.messages); }
    finally { setBusy(false); }
  }
  return <main className="auth-layout">
    <section className="auth-story"><Logo/><div className="story-copy"><span className="eyebrow light">MÁS CLARIDAD EN LO QUE DESEAS HACER</span><h1>El espacio ideal<br/>Para tener todo en un solo lugar<span>.</span></h1><p>Un lugar para organizar tus proyectos, conectar con tu equipo y dar el siguiente paso.</p><div className="story-art" aria-hidden="true"><div className="art-card"><span className="art-tag">EN EQUIPO</span><strong>Una idea. Un plan.<br/>Todo en un mismo lugar.</strong><div className="art-line"/><div className="art-line short"/><div className="art-check"><Icon name="check"/> Un paso más cerca</div></div><span className="art-orbit"/><span className="art-spark">✳</span></div></div><span className="auth-footer">Organiza tus proyectos con claridad.</span></section>
    <section className="auth-form-side"><div className="auth-form-wrap"><span className="eyebrow">TU ESPACIO SEGURO DE TRABAJO</span><h2>{register ? 'Hagamos que suceda.' : '¡Que bueno verte de nuevo!'}</h2><p className="muted">{register ? 'Crea tu cuenta y empieza a construir con tu equipo.' : 'Inicia sesión para continuar donde lo dejaste.'}</p>
      <div className="auth-tabs"><button className={!register ? 'active' : ''} onClick={() => { setRegister(false); setError(''); }}>Iniciar sesión</button><button className={register ? 'active' : ''} onClick={() => { setRegister(true); setError(''); }}>Crear cuenta</button></div>
      <form onSubmit={submit} key={String(register)}><ErrorMessage message={error}/>{register && <label>Nombre completo<input name="name" autoComplete="name" required maxLength={100} placeholder="Ingresa tu nombre"/></label>}<label>Correo electrónico<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="nombre@gmail.com"/></label><label>Contraseña<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={8} maxLength={128} placeholder={register ? 'Mínimo 8 caracteres' : 'Tu contraseña'}/></label><button className="btn primary full" disabled={busy}>{busy ? 'Un momento…' : register ? 'Crear mi cuenta' : 'Entrar a mi espacio'}<Icon name="arrow" size={17}/></button></form><p className="auth-note"><Icon name="users" size={16}/>Un espacio compartido para avanzar juntos.</p>
    </div></section>
  </main>;
}

export function ProjectForm({ project, onClose, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try { const result = await api(`/projects${project ? `/${project.id}` : ''}`, { method: project ? 'PATCH' : 'POST', body }); await onSaved(result.project); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <Modal title={project ? 'Editar proyecto' : 'Un nuevo comienzo'} subtitle={project ? 'Actualiza los detalles de tu proyecto.' : 'Dale un nombre a lo que construirán juntos.'} onClose={() => !busy && onClose()}><form onSubmit={submit}><ErrorMessage message={error}/><label>Nombre del proyecto<input name="name" required maxLength={120} defaultValue={project?.name} placeholder="Ej. Lanzamiento de nuestra web" autoFocus/></label><label>Descripción <span className="optional">opcional</span><textarea name="description" maxLength={5000} rows={4} defaultValue={project?.description} placeholder="¿Qué queremos lograr?"/></label><div className="form-actions"><button type="button" className="btn secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : project ? 'Guardar cambios' : 'Crear proyecto'}</button></div></form></Modal>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const notify = useCallback(message => setToast(message), []);
  async function restore() {
    setBooting(true); setBootError('');
    try { const data = await api('/auth/me'); setUser(data.user); }
    catch (err) { if (err.status !== 401) setBootError(err.message); }
    finally { setBooting(false); }
  }
  useEffect(() => { restore(); }, []);
  useEffect(() => {
    const expired = () => { setUser(null); setProjects([]); setActiveId(null); setCreating(false); setToast('Tu sesión ha vencido. Vuelve a iniciar sesión.'); };
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 5000); return () => clearTimeout(id); }, [toast]);
  const refresh = useCallback(async () => { const data = await api('/projects'); setProjects(data.projects); return data.projects; }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    api('/projects', { signal: controller.signal }).then(data => setProjects(data.projects)).catch(err => { if (err.name !== 'AbortError') setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user]);
  async function logout() {
    setLoggingOut(true);
    try { await api('/auth/logout', { method: 'POST' }); setUser(null); setProjects([]); setActiveId(null); setCreating(false); }
    catch (err) { notify(err.message); }
    finally { setLoggingOut(false); }
  }
  if (booting) return <div className="boot"><Logo/><p>Preparando tu espacio…</p></div>;
  if (bootError) return <div className="boot"><Logo/><ErrorMessage message={bootError}/><button className="btn primary" onClick={restore}>Volver a intentar</button></div>;
  if (!user) return <><Auth onAuthenticated={setUser}/>{toast && <div className="toast" role="status">{toast}</div>}</>;
  const activeProject = projects.find(p => p.id === activeId);
  return <div className="app-shell"><aside className="sidebar"><Logo/><span className="workspace-label">ESPACIO PERSONAL</span><button className={`nav-item ${!activeId ? 'selected' : ''}`} onClick={() => setActiveId(null)}><Icon name="grid"/>Mis proyectos<span className="nav-count">{projects.length}</span></button><div className="sidebar-section"><span>TUS PROYECTOS</span><button className="icon-btn" title="Crear proyecto" onClick={() => setCreating(true)}><Icon name="plus" size={17}/></button></div><nav aria-label="Proyectos" className="project-nav">{projects.map((p, i) => <button key={p.id} className={`project-nav-item ${activeId === p.id ? 'current' : ''}`} onClick={() => setActiveId(p.id)}><span className={`project-dot color-${i % 4}`}/><span>{p.name}</span></button>)}{!projects.length && <p className="sidebar-hint">Tus próximos proyectos<br/>tendrán un lugar aquí.</p>}</nav><div className="sidebar-tip"><span>Un paso a la vez.</span><p>Las pequeñas tareas hacen<br/>posibles las grandes ideas.</p><span className="tip-star">✳</span></div><div className="profile"><Avatar name={user.name}/><div><strong>{user.name}</strong><span title={user.email}>{user.email}</span></div><button className="icon-btn" onClick={logout} disabled={loggingOut} title="Cerrar sesión"><Icon name="logout" size={18}/></button></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><Icon name="grid" size={16}/><button onClick={() => setActiveId(null)}>Mi espacio</button><span>/</span><strong>{activeProject?.name || 'Mis proyectos'}</strong></div><div className="topbar-right"><span className="today">{new Date().toLocaleDateString('es-HN', { day: 'numeric', month: 'long' })}</span><Avatar name={user.name} small/></div></header>
    {activeProject ? <ProjectView key={activeProject.id} project={activeProject} user={user} refreshProjects={refresh} notify={notify} onBack={() => setActiveId(null)}/> : <ProjectOverview projects={projects} user={user} loading={loading} error={error} onRetry={() => { setError(''); refresh().catch(err => setError(err.message)); }} onSelect={setActiveId} onCreate={() => setCreating(true)}/>}
    </div>{creating && <ProjectForm onClose={() => setCreating(false)} onSaved={async project => { await refresh(); setCreating(false); setActiveId(project.id); notify('Tu proyecto está listo. ¡A darle forma!'); }}/>} {toast && <div className="toast" role="status"><Icon name="check" size={18}/>{toast}</div>}
  </div>;
}
