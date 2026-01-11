/**
 * Type Listing Page
 * 
 * Lists entities of a specific type for an organization
 * Route: /:orgSlug/:typeSlug
 */

import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';

interface TypeListingData {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  entityType: {
    id: string;
    name: string;
    pluralName: string;
    slug: string;
  };
  entities: Array<{
    id: string;
    slug: string;
    data: Record<string, unknown>;
  }>;
}

interface TypeListingPageProps {
  orgSlug?: string;
  typeSlug?: string;
}

export function TypeListingPage({ orgSlug, typeSlug }: TypeListingPageProps) {
  const [data, setData] = useState<TypeListingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    if (!orgSlug || !typeSlug) {
      setError('Organization and type slugs are required');
      setLoading(false);
      return;
    }
    
    async function loadData() {
      try {
        const response = await api.get(`/${orgSlug}/${typeSlug}`) as {
          success: boolean;
          data?: TypeListingData;
          error?: { message: string };
        };
        
        if (response.success && response.data) {
          setData(response.data);
        } else {
          setError(response.error?.message || 'Not found');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, [orgSlug, typeSlug]);
  
  if (loading) {
    return (
      <div class="container-wide py-12">
        <div class="text-center">Loading...</div>
      </div>
    );
  }
  
  if (error || !data) {
    return (
      <div class="container-wide py-12">
        <div class="text-center text-red-600">{error || 'Not found'}</div>
      </div>
    );
  }
  
  return (
    <div class="container-wide py-12">
      <div class="max-w-6xl mx-auto">
        <nav class="mb-6">
          <a href={`/${data.organization.slug}`} class="text-primary-600 hover:text-primary-700">
            ← {data.organization.name}
          </a>
        </nav>
        
        <h1 class="text-4xl font-bold mb-8">{data.entityType.pluralName}</h1>
        
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.entities.map(entity => (
            <a
              href={`/${data.organization.slug}/${data.entityType.slug}/${entity.slug}`}
              class="card p-6 hover:shadow-lg transition-shadow"
            >
              <h2 class="text-xl font-semibold mb-2">
                {entity.data.name as string || `Entity ${entity.id}`}
              </h2>
              {entity.data.description && (
                <p class="text-surface-600 dark:text-surface-400 line-clamp-2">
                  {entity.data.description as string}
                </p>
              )}
            </a>
          ))}
        </div>
        
        {data.entities.length === 0 && (
          <div class="text-center py-12 text-surface-500">
            No {data.entityType.pluralName.toLowerCase()} found.
          </div>
        )}
      </div>
    </div>
  );
}
