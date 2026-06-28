export default function ComingSoon({ title, description = 'This section is coming soon.' }) {
  return (
    <div className="m-coming-soon">
      <div className="m-coming-soon-icon">⚡</div>
      <div className="m-coming-soon-title">{title}</div>
      <div className="m-coming-soon-text">{description}</div>
    </div>
  );
}
