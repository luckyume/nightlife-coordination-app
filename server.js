import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 4000);
const isProduction = process.env.NODE_ENV === 'production';
const databasePath = path.join(__dirname, 'data', 'store.json');
const cookieName = 'afterhours.sid';
const sessionLifetime = 14 * 24 * 60 * 60 * 1000;
const geocodeCache = new Map();
const venueCache = new Map();
const pendingVenueSearches = new Map();
const searchWindows = new Map();
let lastGeocodeAt = 0;
let geocodeQueue = Promise.resolve();
const GEOCODER_URL = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const OSM_USER_AGENT = process.env.OSM_USER_AGENT || 'AfterHoursNightlifeApp/1.0 (https://github.com/luckyume/nightlife-coordination-app)';

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.set('trust proxy', 1);

function emptyStore() {
  return { users: [], sessions: [], rsvps: [] };
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not read local store:', error.message);
    return emptyStore();
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const temporaryPath = `${databasePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryPath, databasePath);
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((entry) => {
    const separator = entry.indexOf('=');
    if (separator < 0) return ['', ''];
    return [entry.slice(0, separator).trim(), decodeURIComponent(entry.slice(separator + 1).trim())];
  }).filter(([key]) => key));
}

function getSession(req) {
  const sessionId = parseCookies(req.headers.cookie)[cookieName];
  if (!sessionId) return null;
  const store = readStore();
  const session = store.sessions.find((item) => item.id === sessionId && item.expiresAt > Date.now());
  const user = session && store.users.find((item) => item.id === session.userId);
  return user ? { store, session, user } : null;
}

function setSessionCookie(res, sessionId) {
  const attributes = [
    `${cookieName}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(sessionLifetime / 1000)}`,
  ];
  if (isProduction) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function clearSessionCookie(res) {
  const attributes = [`${cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isProduction) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function validTimezone(value) {
  try {
    const timezone = String(value || 'UTC');
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return timezone;
  } catch {
    return 'UTC';
  }
}

function localDateKey(timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: validTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getGoing(store, userId, timezone) {
  return store.rsvps
    .filter((rsvp) => rsvp.userId === userId && rsvp.date === localDateKey(timezone))
    .map(({ venueId, city }) => ({ venueId, city }));
}

function currentUser(req) {
  return getSession(req)?.user || null;
}

function requireUser(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Sign in to save your plan for tonight.' });
  req.auth = session;
  return next();
}

function isWithinSearchLimit(req) {
  const now = Date.now();
  const address = req.ip || req.socket.remoteAddress || 'unknown';
  const current = searchWindows.get(address);
  const next = !current || now - current.startedAt >= 60_000
    ? { startedAt: now, count: 1 }
    : { ...current, count: current.count + 1 };
  searchWindows.set(address, next);
  return next.count <= 10;
}

function derivePassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, key) => {
      if (error) reject(error);
      else resolve({ salt, hash: key.toString('hex') });
    });
  });
}

async function passwordMatches(password, stored) {
  const [algorithm, salt, expectedHex] = String(stored || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, expected.length, (error, key) => error ? reject(error) : resolve(key));
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function makeSession(store, userId, res) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  store.sessions = store.sessions.filter((session) => session.expiresAt > Date.now());
  store.sessions.push({ id: sessionId, userId, expiresAt: Date.now() + sessionLifetime });
  writeStore(store);
  setSessionCookie(res, sessionId);
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/session', (req, res) => {
  const auth = getSession(req);
  if (!auth) return res.json({ user: null, going: [] });
  const going = getGoing(auth.store, auth.user.id, req.query.timezone);
  return res.json({ user: publicUser(auth.user), going });
});

app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (name.length < 2 || name.length > 48) return res.status(400).json({ error: 'Use a name between 2 and 48 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 10 || password.length > 200) return res.status(400).json({ error: 'Password must be at least 10 characters.' });
  const store = readStore();
  if (store.users.some((user) => user.email === email)) return res.status(409).json({ error: 'An account with that email already exists. Sign in instead.' });
  const { salt, hash } = await derivePassword(password);
  const user = { id: crypto.randomUUID(), name, email, passwordHash: `scrypt$${salt}$${hash}`, createdAt: new Date().toISOString() };
  store.users.push(user);
  makeSession(store, user.id, res);
  return res.status(201).json({ user: publicUser(user), going: getGoing(store, user.id, req.query.timezone) });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const store = readStore();
  const user = store.users.find((item) => item.email === email);
  if (!user || !(await passwordMatches(password, user.passwordHash))) return res.status(401).json({ error: 'That email and password do not match.' });
  makeSession(store, user.id, res);
  const going = getGoing(store, user.id, req.query.timezone);
  return res.json({ user: publicUser(user), going });
});

app.post('/api/auth/logout', (req, res) => {
  const sessionId = parseCookies(req.headers.cookie)[cookieName];
  if (sessionId) {
    const store = readStore();
    store.sessions = store.sessions.filter((session) => session.id !== sessionId);
    writeStore(store);
  }
  clearSessionCookie(res);
  return res.json({ user: null, going: [] });
});

async function geocodeCity(city) {
  const key = city.toLocaleLowerCase();
  const cached = geocodeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const url = `${GEOCODER_URL}?${new URLSearchParams({ q: city, format: 'jsonv2', limit: '1', addressdetails: '1' })}`;
  const request = geocodeQueue.then(async () => {
    const delay = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    lastGeocodeAt = Date.now();
    return fetch(url, {
      headers: { 'User-Agent': OSM_USER_AGENT, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(12_000),
    });
  });
  geocodeQueue = request.then(() => undefined, () => undefined);
  const response = await request;
  if (!response.ok) throw new Error('City lookup is unavailable right now. Try again in a moment.');
  const results = await response.json();
  if (!results.length) return null;
  const result = results[0];
  const [south, north, west, east] = result.boundingbox.map(Number);
  const value = {
    displayName: result.address?.city || result.address?.town || result.address?.municipality || result.name || city,
    fullName: result.display_name,
    lat: Number(result.lat),
    lon: Number(result.lon),
    bounds: [south, west, north, east],
  };
  geocodeCache.set(key, { value, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  return value;
}

function simplifyVenue(element) {
  const tags = element.tags || {};
  const point = element.center || element;
  const venueId = `osm-${element.type}-${element.id}`;
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const address = [street, tags['addr:suburb'] || tags['addr:neighbourhood'] || tags['addr:district']].filter(Boolean).join(', ');
  const amenity = tags.amenity || 'bar';
  const category = amenity === 'pub' ? 'Pub' : amenity === 'nightclub' ? 'Nightclub' : 'Bar';
  const neighborhood = tags['addr:suburb'] || tags['addr:neighbourhood'] || tags['addr:city_district'] || '';
  return {
    venueId,
    name: tags.name || tags['name:en'] || 'Unnamed bar',
    category,
    neighborhood,
    address,
    lat: Number(point.lat),
    lon: Number(point.lon),
    website: tags.website || tags['contact:website'] || null,
    cuisine: tags.cuisine || null,
  };
}

async function fetchVenuesForCity(city, place) {
  const cacheKey = `${city.toLocaleLowerCase()}|${place.lat},${place.lon}`;
  const cached = venueCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { venues: cached.value, dataMode: cached.dataMode || 'live' };
  if (pendingVenueSearches.has(cacheKey)) return pendingVenueSearches.get(cacheKey);
  const query = `[out:json][timeout:12];(node["amenity"~"^(bar|pub|nightclub)$"](around:10000,${place.lat},${place.lon});way["amenity"~"^(bar|pub|nightclub)$"](around:10000,${place.lat},${place.lon}););out center 150;`;
  const pending = (async () => {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': OSM_USER_AGENT },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error('Venue search is busy right now. Try again in a moment.');
    const payload = await response.json();
    const venues = (payload.elements || [])
      .map(simplifyVenue)
      .filter((venue) => venue.name && venue.name !== 'Unnamed bar' && Number.isFinite(venue.lat) && Number.isFinite(venue.lon))
      .sort((a, b) => a.name.localeCompare(b.name));
    const value = venues.slice(0, 150);
    venueCache.set(cacheKey, { value, expiresAt: Date.now() + 30 * 60 * 1000, dataMode: 'live' });
    return { venues: value, dataMode: 'live' };
  })();
  pendingVenueSearches.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    pendingVenueSearches.delete(cacheKey);
  }
}

function sampleVenues(city) {
  const prefix = crypto.createHash('sha256').update(city.toLocaleLowerCase()).digest('hex').slice(0, 8);
  return [
    ['lantern-room', 'The Lantern Room', 'Bar'],
    ['juniper-social', 'Juniper Social', 'Pub'],
    ['lowlight-club', 'Lowlight Club', 'Nightclub'],
    ['sidecar-house', 'Sidecar House', 'Bar'],
  ].map(([slug, name, category]) => ({
    venueId: `demo-${prefix}-${slug}`,
    name,
    category,
    neighborhood: '',
    address: '',
    lat: null,
    lon: null,
    website: null,
    cuisine: null,
    sample: true,
  }));
}

app.get('/api/bars', async (req, res) => {
  const city = String(req.query.city || '').trim().replace(/\s+/g, ' ');
  const today = localDateKey(req.query.timezone);
  if (city.length < 2 || city.length > 100) return res.status(400).json({ error: 'Enter a city or neighborhood between 2 and 100 characters.' });
  if (!isWithinSearchLimit(req)) return res.status(429).json({ error: 'That’s a lot of searches in a short time. Please wait a minute and try again.' });
  let place = null;
  let places = [];
  let dataMode = 'live';
  let message = '';
  try {
    place = await geocodeCity(city);
    if (!place) return res.json({ city, cityLabel: city, bars: [], source: 'OpenStreetMap', dataMode, message: 'We could not find that city. Try adding a state or country.' });
    const result = await fetchVenuesForCity(city, place);
    places = result.venues;
    dataMode = result.dataMode;
    if (dataMode === 'sample') message = 'Live venue data is unavailable. Preview only — these fictional sample places are not real venues.';
  } catch (error) {
    console.error('Live venue lookup failed:', error.message);
    dataMode = 'sample';
    message = 'Live venue data is unavailable. Preview only — these fictional sample places are not real venues.';
    places = sampleVenues(city);
    if (place) venueCache.set(`${city.toLocaleLowerCase()}|${place.lat},${place.lon}`, { value: places, expiresAt: Date.now() + 5 * 60 * 1000, dataMode });
  }
  try {
    const store = readStore();
    const user = currentUser(req);
    const attendeesByVenue = new Map();
    for (const rsvp of store.rsvps) {
      if (rsvp.date !== today) continue;
      attendeesByVenue.set(rsvp.venueId, (attendeesByVenue.get(rsvp.venueId) || 0) + 1);
    }
    const bars = places.map((venue) => {
      const attendeeCount = attendeesByVenue.get(venue.venueId) || 0;
      const going = Boolean(user && store.rsvps.some((rsvp) => rsvp.userId === user.id && rsvp.venueId === venue.venueId && rsvp.date === today));
      return { ...venue, attendeeCount, going };
    });
    return res.json({ city, cityLabel: place?.displayName || city, bars, source: 'OpenStreetMap', fullName: place?.fullName || null, dataMode, message });
  } catch (error) {
    console.error('Venue lookup failed:', error.message);
    return res.status(502).json({ error: error.message || 'Venue search is unavailable right now.' });
  }
});

app.post('/api/rsvps', requireUser, (req, res) => {
  const venueId = String(req.body?.venueId || '');
  const city = String(req.body?.city || '').trim().slice(0, 100);
  const today = localDateKey(req.body?.timezone);
  if (!(/^(osm-(node|way|relation)-\d{1,18}|demo-[a-f0-9]{8}-[a-z-]+)$/.test(venueId)) || city.length < 2) return res.status(400).json({ error: 'That venue could not be saved.' });
  const store = req.auth.store;
  const alreadyGoing = store.rsvps.some((rsvp) => rsvp.userId === req.auth.user.id && rsvp.venueId === venueId && rsvp.date === today);
  if (!alreadyGoing) store.rsvps.push({ userId: req.auth.user.id, venueId, city, date: today, createdAt: new Date().toISOString() });
  writeStore(store);
  return res.json({ ok: true, going: true, venueId });
});

app.delete('/api/rsvps/:venueId', requireUser, (req, res) => {
  const venueId = String(req.params.venueId || '');
  const today = localDateKey(req.query.timezone);
  const store = req.auth.store;
  store.rsvps = store.rsvps.filter((rsvp) => !(rsvp.userId === req.auth.user.id && rsvp.venueId === venueId && rsvp.date === today));
  writeStore(store);
  return res.json({ ok: true, going: false, venueId });
});

if (isProduction) {
  const dist = path.join(__dirname, 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const host = isProduction ? '0.0.0.0' : '127.0.0.1';
app.listen(port, host, () => console.log(`After Hours API listening at http://${host}:${port}`));
