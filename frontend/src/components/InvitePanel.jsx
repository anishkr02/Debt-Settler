import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { copyText } from '../lib/joinLink';
import {
  AtSign, Link2, Mail, Search, Copy, Check, AlertCircle, RefreshCw,
} from 'lucide-react';

const INPUT =
  'w-full px-4 py-3 border border-slate-300 rounded-2xl text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-olive-primary placeholder:text-slate-400';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The one invite UI (Username / Email / Link), used by the Members tab and by
 * the Create Group modal.
 *
 * It doesn't decide what "adding" means. The parent does:
 *  - Members tab: each add calls the API straight away.
 *  - Create Group modal: each add just stages a chip until the group exists.
 *
 * Props
 *  currentUsername   block adding yourself
 *  excludeUsernames  usernames already in the group (blocked with a message)
 *  onAddUsername(username) -> string | void | Promise   throw Error(msg) to refuse
 *  onAddEmail(email)       -> string | void | Promise   throw Error(msg) to refuse
 *  onRequestLink()         -> Promise<string url>       omit if the group doesn't exist yet
 */
export default function InvitePanel({
  currentUsername,
  excludeUsernames = [],
  onAddUsername,
  onAddEmail,
  onRequestLink,
}) {
  const [method, setMethod] = useState('username'); // 'username' | 'email' | 'join_link'
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // username
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [noUserFound, setNoUserFound] = useState(false);
  const [searchedName, setSearchedName] = useState('');
  const [inputError, setInputError] = useState('');

  // email
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState('');

  // link
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [copyState, setCopyState] = useState(''); // '' | 'copied' | 'failed'

  const normalize = (s) => s.trim().replace(/^@+/, '').toLowerCase();

  // Debounced username search.
  useEffect(() => {
    const raw = query.trim().replace(/^@+/, '');
    setInputError('');
    if (raw.length < 2) {
      setResults([]);
      setSearchError('');
      setNoUserFound(false);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    setSearchError('');
    setNoUserFound(false);
    const timer = setTimeout(async () => {
      try {
        const data = await api.searchUsers(raw);
        setResults(data || []);
        setSearchedName(raw);
        setNoUserFound(!data || data.length === 0);
      } catch (err) {
        setSearchError(err.message || 'Could not search users');
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Auto-create the join link the first time the Link tab opens.
  const loadLink = async () => {
    setLinkLoading(true);
    setLinkError('');
    try {
      setLink(await onRequestLink());
    } catch (err) {
      setLinkError(err.message || 'Could not create the link');
    } finally {
      setLinkLoading(false);
    }
  };
  useEffect(() => {
    if (method === 'join_link' && onRequestLink && !link && !linkLoading && !linkError) {
      loadLink();
    }
  }, [method]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMethod = (id) => {
    setMethod(id);
    setNotice('');
    setInputError('');
    setEmailError('');
  };

  const addUsername = async (rawName) => {
    const clean = normalize(rawName);
    if (!clean) return;
    setInputError('');
    setNotice('');
    if (currentUsername && clean === currentUsername.toLowerCase()) {
      setInputError('That is you. The person who creates or is already in the group is added automatically.');
      return;
    }
    if (excludeUsernames.some((u) => u.toLowerCase() === clean)) {
      setInputError(`@${clean} is already in this group`);
      return;
    }
    try {
      setBusy(true);
      const msg = await onAddUsername(clean);
      if (msg) setNotice(msg);
      setQuery('');
      setResults([]);
      setNoUserFound(false);
    } catch (err) {
      setInputError(err.message || 'Could not add that user');
    } finally {
      setBusy(false);
    }
  };

  // Enter / Add button: only ever adds someone who exists.
  const submitUsername = (e) => {
    e.preventDefault();
    const clean = normalize(query);
    if (!clean || searching || busy) return;
    const exact = results.find((r) => r.username.toLowerCase() === clean);
    if (exact) return addUsername(exact.username);
    if (results.length === 1) return addUsername(results[0].username);
    if (results.length > 1) {
      setInputError('Tap the exact person from the list below.');
      return undefined;
    }
    setInputError(`No user named @${clean}. Check the spelling, or invite by email or link.`);
    return undefined;
  };

  const submitEmail = async (e) => {
    e.preventDefault();
    const clean = emailInput.trim().toLowerCase();
    if (!clean) return;
    setEmailError('');
    setNotice('');
    if (!EMAIL_RE.test(clean)) {
      setEmailError('Please enter a valid email address');
      return;
    }
    try {
      setBusy(true);
      const msg = await onAddEmail(clean);
      if (msg) setNotice(msg);
      setEmailInput('');
    } catch (err) {
      setEmailError(err.message || 'Could not add that email');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    const ok = await copyText(link);
    setCopyState(ok ? 'copied' : 'failed');
    setTimeout(() => setCopyState(''), 2500);
  };

  const TABS = [
    { id: 'username', label: 'Username', icon: AtSign },
    { id: 'email', label: 'Email', icon: Mail },
    { id: 'join_link', label: 'Link', icon: Link2 },
  ];

  return (
    <div>
      <div className="flex gap-1 p-1 bg-white rounded-2xl border border-slate-200 mb-4">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => switchMethod(id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-xl transition
              ${method === id ? 'bg-olive-primary text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="mb-3 flex items-center gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          <Check className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {method === 'username' && (
        <div className="space-y-3">
          <form onSubmit={submitUsername} className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                className={INPUT + ' pl-10 pr-4'}
                placeholder="Type a username (e.g. rahul)…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            </div>
            {query.trim().length >= 2 && (
              <button
                type="submit"
                disabled={busy || searching}
                className="px-4 py-3 bg-olive-primary hover:bg-olive-700 text-white text-xs font-bold rounded-2xl transition disabled:opacity-50"
              >
                Add
              </button>
            )}
          </form>

          {inputError && <p className="text-xs text-red-600 font-medium px-1">{inputError}</p>}

          {searchError && (
            <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl p-2.5">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{searchError}</span>
            </div>
          )}

          {searching && <p className="text-xs text-slate-400 italic px-1">Searching users…</p>}

          {noUserFound && query.trim().length >= 2 && !searching && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-1">
              <p className="font-bold">No user named @{searchedName}.</p>
              <p className="text-amber-700">
                They need to sign in to Debt-Settle once first, or invite by email or link instead.
              </p>
            </div>
          )}

          {results.length > 0 && !searching && (
            <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden max-h-44 overflow-y-auto shadow-sm">
              {results.map((u) => (
                <div
                  key={u.id}
                  onClick={() => addUsername(u.username)}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 cursor-pointer transition"
                >
                  <span className="text-sm font-semibold text-slate-800">@{u.username}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      addUsername(u.username);
                    }}
                    disabled={busy}
                    className="px-3 py-1 bg-olive-primary text-white text-xs font-bold rounded-xl transition hover:bg-olive-700 disabled:opacity-50"
                  >
                    + Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {method === 'email' && (
        <form onSubmit={submitEmail} className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="email"
              className={INPUT}
              placeholder="friend@gmail.com"
              value={emailInput}
              onChange={(e) => {
                setEmailInput(e.target.value);
                setEmailError('');
              }}
              autoCapitalize="none"
            />
            <button
              type="submit"
              disabled={!emailInput.trim() || busy}
              className="px-5 py-3 bg-olive-primary hover:bg-olive-700 text-white font-bold text-xs rounded-2xl transition disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {emailError && <p className="text-xs text-red-600 font-medium px-1">{emailError}</p>}
          <p className="text-[11px] text-slate-500 px-1">
            We don&apos;t send emails. Share the app link with them. They&apos;re added when they sign in with this email.
          </p>
        </form>
      )}

      {method === 'join_link' && (
        <div className="p-4 bg-white border border-slate-200 rounded-2xl text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-olive-50 text-olive-primary flex items-center justify-center mx-auto">
            <Link2 className="w-5 h-5" />
          </div>

          {!onRequestLink ? (
            <>
              <p className="text-xs font-bold text-slate-800">
                Your join link will appear after the group is created.
              </p>
              <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                Once you tap &quot;Create group&quot;, a link is generated for you to copy and share.
              </p>
            </>
          ) : linkLoading ? (
            <p className="text-xs text-slate-400 italic">Creating your link…</p>
          ) : linkError ? (
            <div className="space-y-2">
              <p className="text-xs text-red-600">{linkError}</p>
              <button
                type="button"
                onClick={loadLink}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-xl"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Try again
              </button>
            </div>
          ) : link ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                <input
                  readOnly
                  value={link}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 bg-transparent text-xs text-slate-700 focus:outline-none truncate"
                />
                <button
                  type="button"
                  onClick={copyLink}
                  className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg flex items-center gap-1 transition flex-shrink-0"
                >
                  {copyState === 'copied' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copyState === 'copied' ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>
              {copyState === 'failed' && (
                <p className="text-[11px] text-amber-700">Couldn&apos;t copy automatically. Select the link above and copy it.</p>
              )}
              <p className="text-[11px] text-slate-500">
                Anyone who signs in to Debt-Settle and opens this link joins the group.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
