/**
 * Empty State Component
 * 
 * Displays a message when there's no content to show.
 */

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div class="text-center py-12">
      {icon && (
        <div class="w-16 h-16 rounded-full bg-surface-100 dark:bg-surface-800 flex items-center justify-center mx-auto mb-4">
          <span class={`${icon} text-3xl text-surface-400`}></span>
        </div>
      )}
      
      <h3 class="heading-4 mb-2">{title}</h3>
      
      {description && (
        <p class="body-text mb-6 max-w-md mx-auto">
          {description}
        </p>
      )}
      
      {action && (
        action.href ? (
          <a href={action.href} class="btn-primary">
            {action.label}
          </a>
        ) : (
          <button onClick={action.onClick} class="btn-primary">
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
