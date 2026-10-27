import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const CLIENT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function Icon({ name, size = 18, strokeWidth = 1.8 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    close: <><path d="m18 6-12 12" /><path d="m6 6 12 12" /></>,
    moon: <><path d="M20.7 13A8.9 8.9 0 0 1 11 3.3 9 9 0 1 0 20.7 13Z" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    people: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    logout: <><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    external: <><path d="M14 3h7v7" /><path d="M10 14 21 3" /><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('');
}

function cleanWebsite(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value.startsWith('http') ? value : `https://${value}`);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function AttendeeCount({ count = 0 }) {
  if (!count) return <span className="attendee-empty">Be the first</span>;
  return (
    <span className="attendee-group" aria-label={`${count} ${count === 1 ? 'person' : 'people'} going tonight`}>
      <Icon name="people" size={15} />
      <span className="attendee-count">{count} going</span>
    </span>
  );
}

function AuthDialog({ mode, setMode, onClose, onSubmit, loading, error }) {
  const isRegister = mode === 'register';
  useEffect(() => {
    const handleEscape = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="icon-button close-dialog" type="button" onClick={onClose} aria-label="Close sign in dialog"><Icon name="close" /></button>
        <div className="dialog-mark"><Icon name="moon" size={20} /></div>
        <h2 id="auth-title">{isRegister ? 'Make tonight yours.' : 'Welcome back.'}</h2>
        <p className="dialog-copy">Your city search stays right where you left it. Sign in to save your spot for tonight.</p>
        <form className="auth-form" onSubmit={onSubmit}>
          {isRegister && <label>Your name<input name="name" autoComplete="name" minLength="2" maxLength="48" required placeholder="How should we call you?" /></label>}
          <label>Email address<input name="email" autoComplete="email" type="email" required placeholder="you@example.com" /></label>
          <label>Password<input name="password" autoComplete={isRegister ? 'new-password' : 'current-password'} type="password" minLength={isRegister ? 10 : undefined} required placeholder={isRegister ? 'At least 10 characters' : 'Your password'} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={loading}>
            {loading ? 'One moment…' : isRegister ? 'Create account' : 'Sign in'}
            {!loading && <Icon name="arrow" size={17} />}
          </button>
        </form>
        <p className="auth-switch">
          {isRegister ? 'Already have an account?' : 'New to After Hours?'}{' '}
          <button type="button" onClick={() => setMode(isRegister ? 'login' : 'register')}>{isRegister ? 'Sign in' : 'Create an account'}</button>
        </p>
      </section>
    </div>
  );
}

function App() {
  const queryCity = new URLSearchParams(window.location.search).get('city')?.trim() || '';
  const restoredCity = queryCity || localStorage.getItem('afterhours.city') || '';
  const requestedCity = queryCity;
  const [cityInput, setCityInput] = useState(restoredCity);
  const [city, setCity] = useState(requestedCity);
  const [searchVersion, setSearchVersion] = useState(0);
  const [cityLabel, setCityLabel] = useState(requestedCity || 'Your city');
  const [bars, setBars] = useState([]);
  const [loadingBars, setLoadingBars] = useState(Boolean(requestedCity));
  const [lookupError, setLookupError] = useState('');
  const [lookupNotice, setLookupNotice] = useState('');
  const [dataMode, setDataMode] = useState('live');
  const [session, setSession] = useState({ user: null, going: [] });
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [pendingVenue, setPendingVenue] = useState(null);
  const [filter, setFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const [rsvpBusy, setRsvpBusy] = useState('');

  useEffect(() => {
    let active = true;
    fetch(`/api/session?timezone=${encodeURIComponent(CLIENT_TIMEZONE)}`)
      .then((response) => response.json())
      .then((data) => { if (active) setSession(data); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!city) {
      setLoadingBars(false);
      setBars([]);
      setLookupError('');
      setLookupNotice('');
      setDataMode('live');
      return () => { active = false; controller.abort(); };
    }
    setLoadingBars(true);
    setLookupError('');
    fetch(`/api/bars?city=${encodeURIComponent(city)}&timezone=${encodeURIComponent(CLIENT_TIMEZONE)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'We couldn’t load this city right now.');
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        setBars(payload.bars || []);
        setCityLabel(payload.cityLabel || city);
        setLookupError(payload.dataMode === 'sample' ? '' : payload.message || '');
        setLookupNotice(payload.dataMode === 'sample' ? payload.message || '' : '');
        setDataMode(payload.dataMode || 'live');
      })
      .catch((error) => {
        if (!active || error.name === 'AbortError') return;
        setBars([]);
        setLookupError(error.message || 'We couldn’t load this city right now.');
        setLookupNotice('');
        setDataMode('live');
      })
      .finally(() => { if (active) setLoadingBars(false); });
    return () => { active = false; controller.abort(); };
  }, [city, searchVersion, session.user?.id]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 3400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const goingCount = useMemo(() => bars.filter((bar) => bar.going).length, [bars]);
  const goingBars = useMemo(() => bars.filter((bar) => bar.going), [bars]);
  const peopleGoingCount = useMemo(() => bars.filter((bar) => bar.attendeeCount > 0).length, [bars]);
  const visibleBars = useMemo(() => filter === 'going' ? bars.filter((bar) => bar.attendeeCount > 0) : bars, [bars, filter]);

  function submitSearch(event) {
    event.preventDefault();
    const nextCity = cityInput.trim().replace(/\s+/g, ' ');
    if (nextCity.length < 2) return;
    localStorage.setItem('afterhours.city', nextCity);
    window.history.replaceState({}, '', `?city=${encodeURIComponent(nextCity)}`);
    setCity(nextCity);
    setCityLabel(nextCity);
    setFilter('all');
    setSearchVersion((value) => value + 1);
  }

  async function sendRsvp(venue, user = session.user) {
    if (!user) {
      setPendingVenue(venue);
      setAuthMode('login');
      setAuthError('');
      setAuthOpen(true);
      return;
    }
    setRsvpBusy(venue.venueId);
    try {
      const response = await fetch('/api/rsvps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId: venue.venueId, city, timezone: CLIENT_TIMEZONE }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'We couldn’t save that plan.');
      setBars((current) => current.map((bar) => bar.venueId === venue.venueId ? {
        ...bar,
        going: true,
        attendeeCount: bar.attendeeCount + (bar.going ? 0 : 1),
      } : bar));
      setSession((current) => ({ ...current, going: [...(current.going || []).filter((item) => item.venueId !== venue.venueId), { venueId: venue.venueId, city }] }));
      setNotice(`You’re on the list for ${venue.name}.`);
      setPendingVenue(null);
    } catch (error) {
      setNotice(error.message || 'We couldn’t save that plan.');
      setPendingVenue(null);
    } finally {
      setRsvpBusy('');
    }
  }

  async function removeRsvp(venue) {
    setRsvpBusy(venue.venueId);
    try {
      const response = await fetch(`/api/rsvps/${encodeURIComponent(venue.venueId)}?timezone=${encodeURIComponent(CLIENT_TIMEZONE)}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'We couldn’t update that plan.');
      setBars((current) => current.map((bar) => bar.venueId === venue.venueId ? {
        ...bar,
        going: false,
        attendeeCount: Math.max(0, bar.attendeeCount - 1),
      } : bar));
      setSession((current) => ({ ...current, going: current.going.filter((item) => item.venueId !== venue.venueId) }));
      setNotice(`You’re off the list for ${venue.name}.`);
    } catch (error) {
      setNotice(error.message || 'We couldn’t update that plan.');
    } finally {
      setRsvpBusy('');
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    const formData = new FormData(event.currentTarget);
    const payload = {
      email: formData.get('email'),
      password: formData.get('password'),
      ...(authMode === 'register' ? { name: formData.get('name') } : {}),
    };
    try {
      const response = await fetch(`/api/auth/${authMode}?timezone=${encodeURIComponent(CLIENT_TIMEZONE)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'We couldn’t sign you in.');
      setSession(data);
      setAuthOpen(false);
      setAuthError('');
      if (pendingVenue) await sendRsvp(pendingVenue, data.user);
      else setNotice(`Good to see you, ${data.user.name.split(' ')[0]}.`);
    } catch (error) {
      setAuthError(error.message || 'We couldn’t sign you in.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setSession({ user: null, going: [] });
    setNotice('You’re signed out. Your search is still here.');
  }

  const formattedDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const allClear = Boolean(city) && !loadingBars && !lookupError && bars.length === 0;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="After Hours home" onClick={(event) => { event.preventDefault(); setFilter('all'); }}>
          <span className="brand-mark"><Icon name="moon" size={20} strokeWidth={2.1} /></span>
          <span>after<span className="brand-light">hours</span></span>
        </a>
        <div className="header-right">
          <div className="tonight-date"><Icon name="moon" size={16} /><span>{formattedDate}</span></div>
          {session.user ? (
            <div className="signed-in-control">
              <span className="profile-avatar">{initials(session.user.name)}</span>
              <span className="profile-name">{session.user.name.split(' ')[0]}</span>
              <button type="button" className="signout-button" onClick={signOut} aria-label="Sign out"><Icon name="logout" size={16} /></button>
            </div>
          ) : <button className="button button-quiet header-signin" type="button" onClick={() => { setAuthMode('login'); setAuthError(''); setAuthOpen(true); }}>Sign in</button>}
        </div>
      </header>

      <main>
        <section className="intro-section" aria-labelledby="page-title">
          <div className="intro-copy">
            <h1 id="page-title">Make a night<br className="desktop-break" /> of it.</h1>
            <p className="intro-subtitle">Find a bar for tonight, see who’s going, and make the plan happen.</p>
          </div>
          <form className="search-form" onSubmit={submitSearch}>
            <label className="search-label" htmlFor="city-search">Choose your city</label>
            <div className="search-control">
              <Icon name="pin" size={19} />
              <input id="city-search" autoComplete="off" value={cityInput} onChange={(event) => setCityInput(event.target.value)} placeholder="City or neighborhood" aria-label="Search bars by city or neighborhood" />
              <button className="button button-primary search-button" type="submit" disabled={!cityInput.trim() || loadingBars && cityInput.trim() === city}>
                Find spots <Icon name="arrow" size={16} />
              </button>
            </div>
            <span className="search-note">Search one city at a time. Your search stays saved when you sign in.</span>
          </form>
        </section>

        <section className="content-grid" aria-label="Tonight's bars and your plans">
          <div className="venue-column">
            <div className="section-heading">
              <div>
                <p className="section-kicker"><span className="live-dot" /> Tonight in</p>
                <h2>{cityLabel}</h2>
              </div>
              <span className="place-count">{loadingBars ? 'Finding places…' : `${bars.length} ${bars.length === 1 ? 'place' : 'places'}`}</span>
            </div>

            <div className="list-toolbar">
              <div className="list-title">
                <span>Bars & late-night spots</span>
                {!loadingBars && <span className="subtle-count">{visibleBars.length}</span>}
              </div>
              <div className="filter-tabs" role="group" aria-label="Filter venues">
                <button className={filter === 'all' ? 'active' : ''} type="button" onClick={() => setFilter('all')}>All spots</button>
                <button className={filter === 'going' ? 'active' : ''} type="button" onClick={() => setFilter('going')}>Has a plan <span>{peopleGoingCount}</span></button>
              </div>
            </div>

            {dataMode === 'sample' && <div className="sample-notice" role="status"><span className="sample-notice-dot" /><span>{lookupNotice}</span></div>}

            {loadingBars && <div className="loading-list" aria-live="polite"><span className="spinner" /><p>Finding the good spots in {city}…</p></div>}
            {!loadingBars && lookupError && (
              <div className="empty-state lookup-state" role="status">
                <div className="empty-icon"><Icon name="search" size={22} /></div>
                <h3>We couldn’t find those spots.</h3>
                <p>{lookupError}</p>
                <button className="text-button" type="button" onClick={() => setSearchVersion((value) => value + 1)}>Try again <Icon name="arrow" size={15} /></button>
              </div>
            )}
            {!city && !loadingBars && <div className="empty-state"><div className="empty-icon"><Icon name="pin" size={22} /></div><h3>Pick a city to start.</h3><p>Search any city or neighborhood to find its bars and late-night spots.</p></div>}
            {!loadingBars && !lookupError && filter === 'going' && visibleBars.length === 0 && (
              <div className="empty-state"><div className="empty-icon"><Icon name="people" size={22} /></div><h3>No plans here yet.</h3><p>When someone picks a spot for tonight, it’ll show up here.</p><button className="text-button" type="button" onClick={() => setFilter('all')}>See all spots <Icon name="arrow" size={15} /></button></div>
            )}
            {allClear && filter === 'all' && <div className="empty-state"><div className="empty-icon"><Icon name="pin" size={22} /></div><h3>No bars found in {cityLabel}.</h3><p>Try a nearby city or a more specific neighborhood.</p></div>}
            {!loadingBars && !lookupError && visibleBars.length > 0 && (
              <div className="venue-list">
                {visibleBars.map((venue, index) => (
                  <article className="venue-row" key={venue.venueId}>
                    <span className="venue-index">{String(index + 1).padStart(2, '0')}</span>
                    <div className="venue-main">
                      <div className="venue-name-line">
                        <h3>{venue.name}</h3>
                        {venue.website && <a className="venue-link" href={cleanWebsite(venue.website)} target="_blank" rel="noreferrer" aria-label={`Visit ${venue.name} website`}><Icon name="external" size={14} /></a>}
                      </div>
                      <p className="venue-meta"><span>{venue.category}</span>{venue.neighborhood && <><span className="meta-separator">·</span><span>{venue.neighborhood}</span></>}</p>
                      {venue.address && <p className="venue-address">{venue.address}</p>}
                    </div>
                    <div className="venue-social"><AttendeeCount count={venue.attendeeCount} /></div>
                    <button
                      className={`button rsvp-button ${venue.going ? 'button-going' : 'button-outline'}`}
                      type="button"
                      onClick={() => venue.going ? removeRsvp(venue) : sendRsvp(venue)}
                      disabled={rsvpBusy === venue.venueId}
                    >
                      {venue.going ? <><Icon name="check" size={16} /> Going</> : rsvpBusy === venue.venueId ? 'Saving…' : 'I’m going'}
                    </button>
                  </article>
                ))}
              </div>
            )}

            <div className="attribution">
              {dataMode === 'sample' ? <>
                <span>These sample places are for preview only; they are not real venue listings.</span>
                <span>Live venue search uses <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> under its <a href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noreferrer">search use policy</a>.</span>
              </> : <>
                <span>Venue data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>.</span>
                <span>Places within 10 km of the city center; coverage varies. <a href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noreferrer">Search use policy</a>.</span>
              </>}
            </div>
          </div>

          <aside className="plan-card" aria-labelledby="plan-title">
            <div className="plan-card-top">
              <div className="plan-orbit orbit-one" /><div className="plan-orbit orbit-two" /><div className="plan-orbit orbit-three" />
              <div className="plan-icon"><Icon name="moon" size={19} /></div>
              <p className="plan-eyebrow">Your night</p>
              <h2 id="plan-title">A plan is<br />better together.</h2>
              <p className="plan-intro">Pick your place. Let your people know.</p>
            </div>
            {session.user ? (
              <div className="plan-card-body">
                <div className="plan-count"><span className="plan-count-number">{goingCount}</span><span>{goingCount === 1 ? 'place on your list' : 'places on your list'}</span></div>
                {goingBars.length ? (
                  <ul className="plan-list">
                    {goingBars.map((venue) => <li key={venue.venueId}><span className="plan-list-dot" /><span>{venue.name}</span><button type="button" aria-label={`Remove ${venue.name} from your plan`} onClick={() => removeRsvp(venue)} disabled={rsvpBusy === venue.venueId}><Icon name="close" size={14} /></button></li>)}
                  </ul>
                ) : <p className="plan-empty">Your list is open. Pick a spot and you’ll be on it.</p>}
                <p className="plan-signed-in"><span className="signed-dot" /> Signed in as {session.user.name.split(' ')[0]}</p>
              </div>
            ) : (
              <div className="plan-card-body">
                <p className="plan-empty">Save the places you’re considering and see who’s joining.</p>
                <button className="button button-dark plan-cta" type="button" onClick={() => { setAuthMode('register'); setAuthError(''); setAuthOpen(true); }}>Create your account <Icon name="arrow" size={16} /></button>
                <p className="plan-signed-in"><Icon name="people" size={15} /> No account needed to explore</p>
              </div>
            )}
          </aside>
        </section>

        <footer className="site-footer">
          <span>Good company, good places, no group-chat spiral.</span>
          <span>Place search by OpenStreetMap · <a href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noreferrer">usage policy</a></span>
        </footer>
      </main>

      {notice && <div className="toast" role="status"><span className="toast-mark"><Icon name="check" size={15} /></span>{notice}</div>}
      {authOpen && <AuthDialog mode={authMode} setMode={(next) => { setAuthMode(next); setAuthError(''); }} onClose={() => { setAuthOpen(false); setAuthError(''); setPendingVenue(null); }} onSubmit={submitAuth} loading={authLoading} error={authError} />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
