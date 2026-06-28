export default function SectionHeader({ icon: Icon, title, subtitle = null }) {
  return (
    <div className="m-section-header">
      {Icon && (
        <div className="m-section-icon">
          <Icon size={24} />
        </div>
      )}
      <div>
        <h2 className="m-section-title">
          {title}
        </h2>
        {subtitle && (
          <p className="m-section-subtitle">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
