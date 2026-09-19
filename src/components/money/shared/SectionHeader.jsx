export default function SectionHeader({ icon: Icon, title, subtitle = null }) {
  return (
    <div className="m-section-header">
      {Icon && (
        <div className="m-section-icon">
          <Icon size={24} />
        </div>
      )}
      <div>
        {/* h2, not h1: sections' own subheadings are <h3>, so h2->h3 stays
            sequential. c65b9a8 promoted this to <h1>, which skipped a level
            (h1->h3) since nothing promotes those subheads to <h2> — reverted. */}
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
