/**
 * Status Badge Component
 * 
 * Displays entity status with appropriate styling.
 */

import type { EntityStatus } from '@1cc/shared';

interface StatusBadgeProps {
  status: EntityStatus;
}

const statusConfig: Record<EntityStatus, { class: string; label: string }> = {
  draft: { class: 'badge-draft', label: 'Draft' },
  pending: { class: 'badge-pending', label: 'Pending' },
  published: { class: 'badge-published', label: 'Published' },
  archived: { class: 'badge-archived', label: 'Archived' },
  deleted: { class: 'badge-archived', label: 'Deleted' }
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.draft;
  
  return (
    <span class={config.class}>
      {config.label}
    </span>
  );
}
