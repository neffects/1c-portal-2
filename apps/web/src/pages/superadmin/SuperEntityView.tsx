/**
 * Super Entity View Page
 * 
 * Superadmin page for viewing a single entity.
 * Uses the shared EntityViewCore component.
 */

import { useEffect, useState } from 'preact/hooks';
import { route } from 'preact-router';
import { useAuth } from '../../stores/auth';
import { api } from '../../lib/api';
import { EntityViewCore } from '../../components/entities';
import type { Entity, EntityType } from '@1cc/shared';

interface SuperEntityViewProps {
  id?: string;
}

export function SuperEntityView({ id }: SuperEntityViewProps) {
  const { isAuthenticated, isSuperadmin, loading: authLoading } = useAuth();
  
  const [entity, setEntity] = useState<Entity | null>(null);
  const [entityType, setEntityType] = useState<EntityType | null>(null);
  const [entityOrgName, setEntityOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Redirect if not superadmin
  useEffect(() => {
    if (!authLoading.value && (!isAuthenticated.value || !isSuperadmin.value)) {
      console.log('[SuperEntityView] Not authorized, redirecting');
      route('/');
    }
  }, [authLoading.value, isAuthenticated.value, isSuperadmin.value]);
  
  // Load entity and entity type
  useEffect(() => {
    if (isSuperadmin.value && id) {
      loadEntity();
    }
  }, [isSuperadmin.value, id]);
  
  async function loadEntity() {
    if (!id) return;
    
    setLoading(true);
    console.log('[SuperEntityView] Loading entity:', id);
    
    try {
      const response = await api.get(`/api/entities/${id}`) as {
        success: boolean;
        data?: Entity;
      };
      
      if (response.success && response.data) {
        const loadedEntity = response.data;
        setEntity(loadedEntity);
        
        // Load entity type
        const typeResponse = await api.get(`/api/entity-types/${loadedEntity.entityTypeId}`) as {
          success: boolean;
          data?: EntityType;
        };
        
        if (typeResponse.success && typeResponse.data) {
          setEntityType(typeResponse.data);
        }
        
        // Load organization name if entity has an organization
        if (loadedEntity.organizationId) {
          loadOrganizationName(loadedEntity.organizationId);
        } else {
          setEntityOrgName(null);
        }
      } else {
        console.error('[SuperEntityView] Failed to load entity:', response);
        route('/super/entities');
      }
    } catch (err) {
      console.error('[SuperEntityView] Error loading entity:', err);
      route('/super/entities');
    } finally {
      setLoading(false);
    }
  }
  
  async function loadOrganizationName(orgId: string) {
    try {
      const response = await api.get(`/api/organizations/${orgId}`) as {
        success: boolean;
        data?: { name: string; id: string };
      };
      
      if (response.success && response.data) {
        setEntityOrgName(response.data.name);
        console.log('[SuperEntityView] Loaded organization name:', response.data.name);
      } else {
        setEntityOrgName(null);
      }
    } catch (err) {
      console.error('[SuperEntityView] Error loading organization name:', err);
      setEntityOrgName(null);
    }
  }
  
  // Loading state
  if (authLoading.value || loading) {
    return (
      <div class="container-default py-12">
        <div class="max-w-4xl mx-auto">
          <div class="skeleton h-6 w-32 mb-4"></div>
          <div class="skeleton h-12 w-3/4 mb-4"></div>
          <div class="skeleton h-5 w-24 mb-8"></div>
          <div class="skeleton h-32 w-full mb-6"></div>
          <div class="skeleton h-48 w-full"></div>
        </div>
      </div>
    );
  }
  
  if (!entity || !entityType) {
    return null;
  }
  
  return (
    <div class="container-default py-8">
      <EntityViewCore
        basePath="/super"
        entity={entity}
        entityType={entityType}
        orgName={entityOrgName}
      />
    </div>
  );
}
