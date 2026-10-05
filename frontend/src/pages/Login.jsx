import React, { useState } from "react";
import { ArrowRight, Loader2, Lock, Mail, Sparkles } from "lucide-react";
import AuthLayout, { AuthField, CheckRow } from "../components/AuthLayout";
import { login as apiLogin, setToken } from "../api/neuralpricer";
import { ErrorBanner } from "../components/ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login({ theme, onToggleTheme, onNavigate, onAuth }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => {
    setBanner(null);
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const validate = () => {
    const er = {};
    if (!EMAIL_RE.test(form.email.trim())) er.email = "Enter a valid email address";
    if (form.password.length < 6) er.password = "Password must be at least 6 characters";
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validate() || busy) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await apiLogin({ email: form.email.trim(), password: form.password });
      setToken(res.token);
      setBusy(false);
      onAuth({ ...(res.user || {}), email: (res.user && res.user.email) || form.email.trim(), remember });
    } catch (err) {
      setBusy(false);
      setBanner({ kind: "error", msg: err.message || "Sign in failed" });
    }
  };

  const demoLogin = async () => {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await apiLogin({ email: "demo@neuralpricer.io", password: "demo1234" });
      setToken(res.token);
      setBusy(false);
      onAuth({ ...(res.user || {}), remember: true });
    } catch (err) {
      setBusy(false);
      setBanner({ kind: "error", msg: err.message || "Demo login failed — create an account first" });
    }
  };

  return (
    <AuthLayout theme={theme} onToggle={onToggleTheme} onNavigate={onNavigate}>
      <div className="bg-np-panel border border-np-border rounded-2xl p-7 sm:p-9 glow-accent">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-np-cyan">Sign in</p>
        <h1 className="text-2xl font-bold tracking-tight mt-2">Welcome back</h1>
        <p className="text-sm text-np-muted mt-1.5">
          New to NeuralPricer?{" "}
          <button
            type="button"
            onClick={() => onNavigate("signup")}
            className="text-np-accent hover:underline font-medium"
          >
            Create an account
          </button>
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
          {banner && <ErrorBanner message={banner.msg} />}
          <AuthField
            label="Email"
            type="email"
            value={form.email}
            onChange={set("email")}
            placeholder="you@quant.fund"
            icon={Mail}
            error={errors.email}
            autoComplete="email"
          />
          <AuthField
            label="Password"
            type="password"
            value={form.password}
            onChange={set("password")}
            placeholder="••••••••"
            icon={Lock}
            error={errors.password}
            hint={
              <button
                type="button"
                title="Password reset is not wired up in this demo"
                className="text-np-muted/70 hover:text-np-accent transition-colors normal-case"
              >
                Forgot password?
              </button>
            }
            autoComplete="current-password"
          />

          <CheckRow checked={remember} onChange={setRemember}>
            Keep me signed in on this device
          </CheckRow>

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-np-accent text-np-bg font-semibold text-sm
                       py-2.5 rounded-lg hover:brightness-110 active:scale-[0.98] transition-all duration-150
                       disabled:opacity-60 disabled:pointer-events-none shadow-[0_0_18px_rgba(88,166,255,0.35)]"
          >
            {busy ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Signing in…
              </>
            ) : (
              <>
                Sign in <ArrowRight size={15} />
              </>
            )}
          </button>
        </form>

        <div className="flex items-center gap-3 my-5">
          <span className="h-px flex-1 bg-np-border" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-np-muted">or</span>
          <span className="h-px flex-1 bg-np-border" />
        </div>

        <button
          type="button"
          onClick={demoLogin}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 border border-np-border text-np-text text-sm
                     py-2.5 rounded-lg hover:border-np-violet/60 hover:bg-np-violet/10 transition-all duration-150
                     disabled:opacity-60"
        >
          <Sparkles size={15} className="text-np-violet" /> Explore the demo dashboard
        </button>

        <p className="mt-6 text-[11px] leading-relaxed text-np-muted/70 font-mono">
          Sessions are stored in MongoDB — sign in to attribute every priced quote to your account.
        </p>
      </div>
    </AuthLayout>
  );
}
