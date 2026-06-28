import { AlertCircle } from 'lucide-react';

export default function EmptyState({ title, message, icon: Icon = AlertCircle, action = null }) {
  return (
    <div className="m-empty-state">
      <div className="m-empty-icon">
        <Icon size={32} />
      </div>
      <div className="m-empty-title">{title}</div>
      <div className="m-empty-text">{message}</div>
      {action && (
        <div className="m-mt-2">
          {action}
        </div>
      )}
    </div>
  );
}
