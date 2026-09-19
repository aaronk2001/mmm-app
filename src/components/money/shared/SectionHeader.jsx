export default function SectionHeader({ icon: Icon, title, subtitle = null }) {
  return (
    <div className="m-section-header">
      {Icon && (
        <div className="m-section-icon">
          <Icon size={24} />
        </div>
      )}
      <div>
        {/* Every section renders exactly one SectionHeader and nothing else in
            the app renders an <h1> (grepped), so this is the page's one true
            top-level heading; sections' own <h3> subheadings nest under it
            without skipping a level. */}
        <h1 className="m-section-title">
          {title}
        </h1>
        {subtitle && (
          <p className="m-section-subtitle">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
