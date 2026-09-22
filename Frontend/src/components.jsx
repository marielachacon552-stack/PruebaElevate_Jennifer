import React, { useEffect, useRef } from 'react';

export function Icon({ name, size = 20, ...props }) {
  const paths = {
    filter: <><path d="M4 7h16M7 12h10M10 17h4"/><circle cx="8" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/></>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="white"/><circle cx="15" cy="17" r="3" fill="white"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="m9 5 7 7-7 7"/>,
    back: <path d="m14 5-7 7 7 7"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    message: <path d="M21 11a8 8 0 0 1-8 8H7l-5 3V11a9 9 0 0 1 19 0Z"/>,
    edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15Z"/></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    logout: <><path d="M9 4H4v16h5m5-12 4 4-4 4m-6-4h13"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    board: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16"/></>,
    list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.grid}</svg>;
}
export function Logo() { return <span className="brand"><span className="brand-mark"><i/><i/></span>elevate<span className="brand-dot">.</span></span>; }
export function Avatar({ name = '?', small = false }) { return <span className={`avatar ${small ? 'small' : ''}`} title={name}>{name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase()}</span>; }
export function ErrorMessage({ message }) { return message ? <div className="error" role="alert">{message}</div> : null; }
export function Empty({ title, children, action }) { return <div className="empty"><span className="empty-icon"><Icon name="grid" size={28}/></span><h3>{title}</h3><p>{children}</p>{action}</div>; }
export function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = previous; };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) { const r = ref.current.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="close"/></button></div>{children}
  </dialog>;
}
export const statusNames = { todo: 'Por hacer', doing: 'En curso', done: 'Completadas' };
export const priorityNames = { baja: 'Baja', media: 'Media', alta: 'Alta' };
export function dateLabel(value) { return value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('es-HN', { day: 'numeric', month: 'short' }) : 'Sin fecha'; }
export function isOverdue(task) { const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; return task.due_date && task.status !== 'done' && task.due_date < today; }
