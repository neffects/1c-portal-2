/**
 * Organization Home Page
 * 
 * Landing page for an organization showing available entity types
 * Route: /:orgSlug
 */

import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';

interface OrgHomeData {
  organization: {
    id: string;
    name: string;
    slug: string;
    description?: string;
  };
  entityTypes: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
}

interface OrgHomePageProps {
  orgSlug?: string;
}

export function OrgHomePage({ orgSlug }: OrgHomePageProps) {
  const [data, setData] = useState<OrgHomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    if (!orgSlug) {
      setError('Organization slug is required');
      setLoading(false);
      return;
    }
    
    async function loadData() {
      try {
        const response = await api.get(`/${orgSlug}`) as {
          success: boolean;
          data?: OrgHomeData;
          error?: { message: string };
        };
        
        if (response.success && response.data) {
          setData(response.data);
        } else {
          setError(response.error?.message || 'Organization not found');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load organization');
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, [orgSlug]);
  
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
        <div class="text-center text-red-600">{error || 'Organization not found'}</div>
      </div>
    );
  }
  
  return (
    <div class="container-wide py-12">
      <div class="max-w-4xl mx-auto">
        <h1 class="text-4xl font-bold mb-4">{data.organization.name}</h1>
        {data.organization.description && (
          <p class="text-lg text-surface-600 dark:text-surface-400 mb-8">
            {data.organization.description}
          </p>
        )}
        
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {data.entityTypes.map(type => (
            <a
              href={`/${data.organization.slug}/${type.slug}`}
              class="card p-6 hover:shadow-lg transition-shadow"
            >
              <h2 class="text-xl font-semibold mb-2">{type.name}</h2>
              <p class="text-surface-600 dark:text-surface-400">Browse {type.name}</p>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
