/**
 * Organization Utilities
 * 
 * Shared utilities for working with organizations
 */

import { R2_PATHS } from '@1cc/shared';
import { readJSON, listFiles, getOrgProfilePath } from './r2';
import type { Organization } from '@1cc/shared';

/**
 * Find an organization by its slug
 */
export async function findOrgBySlug(bucket: R2Bucket, slug: string): Promise<Organization | null> {
  console.log('[Orgs] Finding organization by slug:', slug);
  const prefix = `${R2_PATHS.PRIVATE}orgs/`;
  const orgFiles = await listFiles(bucket, prefix);
  
  // Use the same improved filtering logic as the listing endpoint
  const profileFiles = orgFiles.filter(f => {
    // Check both with and without leading slash
    const endsWithProfile = f.endsWith('/profile.json') || f.endsWith('profile.json');
    const hasOrgs = f.includes('/orgs/') || f.includes('orgs/');
    return endsWithProfile && hasOrgs;
  });
  
  console.log('[Orgs] Checking', profileFiles.length, 'profile files for slug:', slug);
  
  for (const file of profileFiles) {
    const org = await readJSON<Organization>(bucket, file);
    if (org) {
      console.log('[Orgs] Checking org:', org.id, 'slug:', org.slug, 'matches?', org.slug === slug);
      if (org.slug === slug) {
        console.log('[Orgs] Found matching organization:', org.id, org.name);
        return org;
      }
    }
  }
  
  console.log('[Orgs] No organization found with slug:', slug);
  return null;
}
