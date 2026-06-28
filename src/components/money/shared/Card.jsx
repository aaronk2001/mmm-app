export default function Card({ children, className = '', variant = 'default', hoverable = true, ...props }) {
  const baseClass = hoverable ? 'm-card' : 'm-card m-card-no-hover';
  return (
    <div className={`${baseClass} ${className}`} {...props}>
      {children}
    </div>
  );
}
