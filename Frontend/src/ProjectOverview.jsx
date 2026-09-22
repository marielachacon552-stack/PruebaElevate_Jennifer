import React, { useState } from 'react';
import { Empty, ErrorMessage, Icon } from './components';

export default function ProjectOverview({ projects, user, loading, error, onRetry, onSelect, onCreate }) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [sort, setSort] = useState('recent');
  const total = projects.reduce((sum, project) => sum + project.task_count, 0);
  const done = projects.reduce((sum, project) => sum + project.done_count, 0);
  const filtered = projects.filter(project => {
    const matchesText = `${project.name} ${project.description}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es'));
    return matchesText && (role === 'all' || (role === 'owner' ? project.owner_id === user.id : project.owner_id !== user.id));
  }).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'es') : new Date(b.created_at) - new Date(a.created_at));
  const clear = () => { setSearch(''); setRole('all'); };

  return <main className="workspace project-hub">
    <header className="page-heading">
      <div><span className="eyebrow">TU ESPACIO DE TRABAJO</span><h1>Mis proyectos</h1><p>Hola, {user.name.split(' ')[0]}. Elige un proyecto para ver sus tareas y colaborar con tu equipo.</p></div>
      <button className="btn primary" onClick={onCreate}><Icon name="plus" size={18}/>Nuevo proyecto</button>
    </header>
    <section className="hub-summary" aria-label="Resumen de todos tus proyectos">
      <div><span className="stat-icon sage"><Icon name="grid"/></span><span><strong>{loading ? '—' : projects.length}</strong><span>Proyectos en los que participas</span></span></div>
      <div><span className="stat-icon sand"><Icon name="clock"/></span><span><strong>{loading ? '—' : total - done}</strong><span>Tareas por completar</span></span></div>
      <div><span className="stat-icon lavender"><Icon name="check"/></span><span><strong>{loading ? '—' : done}</strong><span>Tareas completadas</span></span></div>
    </section>

    <section className="projects-section" aria-labelledby="projects-title">
      <div className="section-heading"><div><h2 id="projects-title">Tus proyectos</h2><p>Abre un proyecto para gestionar sus tareas, personas y avances.</p></div></div>
      <div className="hub-controls">
        <div className="segmented" aria-label="Filtrar proyectos por tu rol">
          {[['all', 'Todos'], ['owner', 'Soy propietario'], ['member', 'Soy miembro']].map(([value, label]) => <button key={value} aria-pressed={role === value} className={role === value ? 'active' : ''} onClick={() => setRole(value)}>{label}</button>)}
        </div>
        <label className="search-box"><Icon name="search" size={18}/><input aria-label="Buscar proyectos" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nombre o descripción"/></label>
        <label className="sort-control"><span>Ordenar</span><select aria-label="Ordenar proyectos" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Más recientes</option><option value="name">Nombre A–Z</option></select></label>
      </div>
      <ErrorMessage message={error}/>
      {error && <button className="btn secondary" onClick={onRetry}>Volver a cargar proyectos</button>}
      {loading ? <p className="loading" role="status">Cargando tus proyectos…</p> : !error && <>
        {projects.length > 0 && <p className="results-caption" role="status">{filtered.length} {filtered.length === 1 ? 'proyecto' : 'proyectos'}{search || role !== 'all' ? ` de ${projects.length}` : ''}{(search || role !== 'all') && <button onClick={clear}>Limpiar filtros</button>}</p>}
        {filtered.length ? <div className="project-grid">{filtered.map(project => {
          const progress = project.task_count ? Math.round(project.done_count / project.task_count * 100) : 0;
          const pending = project.task_count - project.done_count;
          return <button className="project-card" key={project.id} onClick={() => onSelect(project.id)} aria-label={`Abrir proyecto: ${project.name}`}>
            <div className="project-card-top"><span className={`project-symbol color-${project.id % 4}`}><Icon name="grid" size={23}/></span><span className="project-role">{project.owner_id === user.id ? 'Propietario' : 'Miembro'}</span></div>
            <h3>{project.name}</h3>
            <p className="project-description">{project.description || 'Sin descripción. Abre el proyecto para ver sus tareas y su equipo.'}</p>
            <div className="card-facts"><span><Icon name="users" size={16}/>{project.member_count} {project.member_count === 1 ? 'miembro' : 'miembros'}</span><span><Icon name="clock" size={16}/>{pending} {pending === 1 ? 'pendiente' : 'pendientes'}</span></div>
            <div className="progress-label"><span>{project.done_count} de {project.task_count} tareas completadas</span><strong>{progress}%</strong></div>
            <progress aria-label={`Progreso de ${project.name}`} max={project.task_count || 1} value={project.done_count}/>
            <div className="card-open"><span>{project.task_count === 0 ? 'Añade la primera tarea' : pending === 0 ? 'Todas las tareas completadas' : 'Ver tareas y equipo'}</span><strong>Abrir proyecto <Icon name="arrow" size={16}/></strong></div>
          </button>;
        })}</div> : projects.length ? <Empty title="No hay proyectos con estos filtros" action={<button className="btn secondary" onClick={clear}>Ver todos los proyectos</button>}>Prueba con otro nombre o cambia el filtro de tu rol.</Empty> : <div className="getting-started">
          <Empty title="Crea tu primer proyecto" action={<button className="btn primary" onClick={onCreate}><Icon name="plus" size={18}/>Crear proyecto</button>}>Un proyecto reúne las tareas, las personas y las conversaciones de un mismo trabajo.</Empty>
          <ol className="setup-steps"><li><span>1</span><div><strong>Crea un proyecto</strong><p>Define qué van a realizar.</p></div></li><li><span>2</span><div><strong>Añade a tu equipo</strong><p>Elige personas registradas.</p></div></li><li><span>3</span><div><strong>Organiza las tareas</strong><p>Asigna responsables y fechas.</p></div></li></ol>
        </div>}
      </>}
    </section>
  </main>;
}
