import { Info } from 'lucide-react';
import Tooltip from './Tooltip';

export default function InfoIcon({ content, size = 13 }) {
  return (
    <Tooltip content={content}>
      <Info size={size} style={{ color: 'var(--m-muted)' }} aria-label="More information" />
    </Tooltip>
  );
}
