# Environment Configuration

This document describes the environment variables required for the 1CC Portal frontend.

## Environment Files

Create the following files in this directory for each environment:

### `.env.staging`

```bash
# Staging environment configuration
# Used when building for staging deployment (develop branch)

# API endpoint for staging Worker
VITE_API_URL=https://api-staging.1cc-portal.workers.dev

# Environment identifier
VITE_ENVIRONMENT=staging

# Enable debug logging in staging
VITE_DEBUG=true
```

### `.env.production`

```bash
# Production environment configuration
# Used when building for production deployment (main branch)

# API endpoint for production Worker
VITE_API_URL=https://api.1cc-portal.workers.dev

# Environment identifier
VITE_ENVIRONMENT=production

# Disable debug logging in production
VITE_DEBUG=false
```

## Usage

Vite automatically loads environment files based on the build mode:

```bash
# Development (uses .env or .env.development)
npm run dev

# Staging build
npm run build -- --mode staging

# Production build
npm run build -- --mode production
```

## CI/CD Notes

In GitHub Actions, these values are set as environment variables directly rather than using .env files:

```yaml
env:
  VITE_API_URL: ${{ secrets.VITE_API_URL_STAGING }}
  VITE_ENVIRONMENT: staging
  VITE_DEBUG: true
```
