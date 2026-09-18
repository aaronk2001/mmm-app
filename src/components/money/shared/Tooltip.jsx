import { useState, useId } from 'react';

export default function Tooltip({ content, placement = 'top', children }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!content) return children;
  return (
    <span className="m-tooltip"
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      <span aria-describedby={open ? id : undefined} tabIndex={0} style={{ display: 'inline-flex' }}>
        {children}
      </span>
      {open && <span role="tooltip" id={id} className={`m-tooltip-bubble m-tooltip-${placement}`}>{content}</span>}
    </span>
  );
}
