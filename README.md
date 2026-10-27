# After Hours

A full-stack nightlife coordination app for finding bars in a city and seeing who plans to go tonight.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The Vite development server proxies `/api` requests to the Node server on port `4000`.

For a production build:

```sh
npm run build
npm start
```

The Node server serves the built client when `dist/` exists. Set `NODE_ENV=production` and `PORT` in the deployment environment. `OSM_USER_AGENT` can be set to a stable application identifier and contact URL; `OVERPASS_URL` can switch the venue-query service without a code change.

## Features

- Search a city or neighborhood without an account.
- Create an account or sign in, then RSVP to a bar for tonight or remove your RSVP.
- The public venue list shows attendee counts without exposing attendee names.
- The current search stays in the URL and browser storage while the sign-in dialog is open, so login returns to the same city.
- Server-side session cookies and password hashes use Node's `crypto.scrypt` implementation.
- RSVPs are grouped by the visitor's local calendar date and persist in a local JSON store.

## Venue data and attribution

Place search uses OpenStreetMap's Nominatim geocoder and Overpass API. The app does not use Yelp. It sends city searches only after a visitor submits the search form, throttles Nominatim requests, and caches geocoding and venue results in memory. Live venue results cover a 10 km radius around the selected city's geocoded center. If the public venue service is unavailable, the app shows clearly labeled fictional sample listings so the planner can still be previewed. Venue coverage depends on community mapping. The interface credits OpenStreetMap contributors, whose data is available under the Open Database License (ODbL), and links to the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).

## Storage note

The app writes local account and RSVP data to `data/store.json`; that runtime data is ignored by Git. This single-process JSON store is suitable for a small demo. A multi-instance deployment should replace it with a managed database and a shared session store.
