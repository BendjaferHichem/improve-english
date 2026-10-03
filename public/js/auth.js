import { getSupabase } from './api.js';

const $ = (s) => document.querySelector(s);
const form = $('#authForm');
const errorBox = $('#authError');
const infoBox = $('#authInfo');
const submit = $('#submitBtn');
let mode = 'signin';

const next = () => {
  const target = new URLSearchParams(location.search).get('next') || '/dashboard';
  return target.startsWith('/') && !target.startsWith('//') ? target : '/dashboard';
};

const FRIENDLY = {
  'Invalid login credentials': 'That email and password don\'t match. Please check them and try again.',
  'User already registered': 'An account with this email already exists. Try signing in instead.',
  'Email not confirmed': 'Please confirm your email first. We sent you a link.',
};
function friendly(err) {
  if (/password should be at least/i.test(err.message)) return 'Please choose a password with at least 6 characters.';
  if (/rate limit/i.test(err.message)) return 'Too many attempts. Please wait a minute and try again.';
  return FRIENDLY[err.message] || err.message || 'Something went wrong. Please try again.';
}

function setMode(next) {
  mode = next;
  const signup = mode === 'signup';
  $('#title').textContent = signup ? 'Create your account' : 'Welcome back';
  submit.textContent = signup ? 'Create account' : 'Sign in';
  $('#switchText').textContent = signup ? 'Already have an account?' : 'New here?';
  $('#switchBtn').textContent = signup ? 'Sign in' : 'Create an account';
  $('#password').autocomplete = signup ? 'new-password' : 'current-password';
  $('#forgotBtn').hidden = signup;
  errorBox.hidden = infoBox.hidden = true;
}

$('#switchBtn').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
if (new URLSearchParams(location.search).get('mode') === 'signup') setMode('signup');

$('#googleBtn').addEventListener('click', async () => {
  errorBox.hidden = infoBox.hidden = true;
  try {
    const { supabase } = await getSupabase();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + next() },
    });
    if (error) throw error;
  } catch (err) {
    errorBox.textContent = err.code === 'network' || err.code === 'not_configured' ? err.message : friendly(err);
    errorBox.hidden = false;
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.hidden = infoBox.hidden = true;
  submit.disabled = true;
  const email = $('#email').value.trim();
  const password = $('#password').value;
  try {
    const { supabase } = await getSupabase();
    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        infoBox.textContent = 'Almost there! Check your email for a confirmation link, then sign in.';
        infoBox.hidden = false;
        setMode('signin');
        infoBox.hidden = false;
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    location.replace(next());
  } catch (err) {
    errorBox.textContent = err.code === 'network' || err.code === 'not_configured' ? err.message : friendly(err);
    errorBox.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

$('#forgotBtn').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  errorBox.hidden = infoBox.hidden = true;
  if (!email) { errorBox.textContent = 'Enter your email above first, then tap "Forgot password".'; errorBox.hidden = false; return; }
  try {
    const { supabase } = await getSupabase();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/login' });
    if (error) throw error;
    infoBox.textContent = 'If that email has an account, a reset link is on its way.';
    infoBox.hidden = false;
  } catch (err) {
    errorBox.textContent = friendly(err);
    errorBox.hidden = false;
  }
});

// Already signed in? Skip the form.
getSupabase().then(async ({ supabase }) => {
  const { data } = await supabase.auth.getSession();
  if (data.session) location.replace(next());
}).catch((err) => { errorBox.textContent = err.message; errorBox.hidden = false; });
