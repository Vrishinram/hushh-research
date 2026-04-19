# 🔒 Hussh — Privacy Trust Dashboard

> A Next.js API powering a user-centric privacy dashboard. Monitor connected services, manage granular permissions, and audit every data access attempt.

## Quick Start

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev

# Test the API
curl http://localhost:3000/api/trust-data
```

## API Reference

### `GET /api/trust-data`

Returns the complete trust data payload for the authenticated user.

**Response `200 OK`**

```json
{
  "user": {
    "id": "usr_7f3a2b91c4e8",
    "email": "user@hussh.io",
    "trustScore": 87
  },
  "connected_services": [ ... ],
  "permissions": [ ... ],
  "access_logs": [ ... ],
  "metadata": {
    "generatedAt": "2026-03-25T05:39:41Z",
    "version": "1.0.0"
  }
}
```

**Error `500 Internal Server Error`**

```json
{
  "error": "An unexpected error occurred"
}
```

## Data Model

### Connected Services

Each entry represents a third-party integration linked to the user's account.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique service ID |
| `name` | `string` | Display name (e.g. "Google Workspace") |
| `icon` | `string` | Icon identifier for the frontend |
| `status` | `"Active" \| "Pending" \| "Revoked"` | Current connection state |
| `connectedAt` | `string` (ISO 8601) | When the service was first linked |
| `scopes` | `string[]` | OAuth scopes granted |
| `lastSync` | `string` (ISO 8601) | Last successful data sync |

### Permissions

Granular user-controlled privacy toggles organized by category.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique permission ID |
| `category` | `string` | Group: Data Sharing, Notifications, Security, Privacy |
| `label` | `string` | Human-readable name |
| `description` | `string` | What this permission controls |
| `state` | `"On" \| "Off"` | Current toggle state |
| `lastModified` | `string` (ISO 8601) | Last time the user changed this |

### Access Logs

Immutable audit trail of every data access attempt.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique log entry ID |
| `timestamp` | `string` (ISO 8601) | When the access occurred |
| `service` | `string` | Which service made the request |
| `action` | `string` | HTTP-style verb: `READ`, `WRITE` |
| `resource` | `string` | The endpoint/resource accessed |
| `result` | `"Authorized" \| "BLOCKED_BY_CONSENT" \| "Denied" \| "Rate_Limited"` | Outcome |
| `ip` | `string` | Source IP address |

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router + Turbopack) |
| Language | TypeScript 5 (strict mode) |
| Runtime | React 19, Node.js |

## Project Structure

```
hussh-project/
├── src/
│   └── app/
│       └── api/
│           └── trust-data/
│               └── route.ts      ← API route (GET handler)
├── package.json
├── tsconfig.json
├── next.config.ts
└── README.md
```

## License

MIT
