// Tiny markdown-lite renderer for Learn step prose (Sprint D, Wave 2).
//
// server/learn/template.js already HTML-escapes every interpolated
// {{variable}} value and hands back plain text (its `html` field name is
// about escaping, not markup — the source is markdown, not real HTML). We
// never use dangerouslySetInnerHTML here: decode the escaping back to plain
// characters, then build real React text nodes so React's own escaping is
// the only escaping that happens. That also means this component can never
// execute injected markup — a lesson (or a fabricated variable value) is
// data, never code, all the way to the screen.
//
// Supports exactly what real lesson content uses (content/learn/**/*.md):
// blank-line paragraphs, `- ` bullet lists, and `**bold**` spans. Nothing
// else is needed and nothing else is parsed.

const ENTITY_MAP = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
function decodeEntities(s) {
  return String(s || '').replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, (m) => ENTITY_MAP[m]);
}

function renderInline(text, keyPrefix) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
      return <strong key={`${keyPrefix}-b${i}`}>{part.slice(2, -2)}</strong>;
    }
    return part ? <span key={`${keyPrefix}-t${i}`}>{part}</span> : null;
  });
}

export default function LessonProse({ text, style }) {
  const decoded = decodeEntities(text);
  const blocks = decoded.split(/\r?\n\r?\n+/).map((b) => b.trim()).filter(Boolean);

  return (
    <div style={{ display: 'grid', gap: 12, ...style }}>
      {blocks.map((block, bi) => {
        const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const isList = lines.length > 0 && lines.every((l) => l.startsWith('- '));
        if (isList) {
          return (
            <ul key={bi} style={{ margin: 0, paddingLeft: 20, color: 'var(--m-ink-2)', fontSize: 14, lineHeight: 1.6 }}>
              {lines.map((l, li) => <li key={li}>{renderInline(l.slice(2), `${bi}-${li}`)}</li>)}
            </ul>
          );
        }
        return (
          <p key={bi} style={{ margin: 0, color: 'var(--m-ink-2)', fontSize: 14, lineHeight: 1.6 }}>
            {renderInline(lines.join(' '), String(bi))}
          </p>
        );
      })}
    </div>
  );
}
