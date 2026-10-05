import React, { useMemo, useState } from "react";
import { ArrowRight, Loader2, Lock, Mail, ShieldCheck, User } from "lucide-react";
import AuthLayout, { AuthField, CheckRow } from "../components/AuthLayout";
import { register as apiRegister, setToken } from "../api/neuralpricer";
import { ErrorBanner } from "../components/ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function strength(pw) {
  if (!pw) return { score: 0, label: "", color: "bg-np-border" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[0-9]/.test(pw) && /[a-zA-Z]/.test(pw)) s++;
  if (/[^a-zA-Z0-9]/.test(pw)) s++;
  const meta = [
    { label: "Too weak", color: "bg-np-red" },
    { label: "Weak", color: "bg-np-red" },
    { label: "Fair", color: "bg-np-amber" },
    { label: "Good", color: "bg-np-accent" },
    { label: "Strong", color: "bg-np-green" },
  ][s];
  return { score: s, ...meta };
}

export default function Signup({ theme, onToggleTheme, onNavigate, onAuth }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);

  const st = useMemo(() => strength(form.password), [form.password]);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
    setBanner(null);
  };

  const validate = () => {
    const er = {};
    if (form.name.trim().length < 2) er.name = "Tell us your name (min 2 characters)";
    if (!EMAIL_RE.test(form.email.trim())) er.email = "Enter a valid email address";
    if (form.password.length < 8) er.password = "Use at least 8 characters";
    else if (st.score < 2) er.password = "Add numbers or symbols to strengthen it";
    if (form.confirm !== form.password) er.confirm = "Passwords do not match";
    if (!agree) er.agree = "Please accept the terms to continue";
    setErrors(er);
    return Object.keys(er).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validate() || busy) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await apiRegister({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      setToken(res.token);
      setBusy(false);
      onAuth({ ...(res.user || {}), remember: true });
    } catch (err) {
      setBusy(false);
      setBanner({ kind: "error", msg: err.message || "Registration failed" });
    }
  };

  return (
    <AuthLayout theme={theme} onToggleTheme={onToggleTheme} onNavigate={onNavigate}>
      <div className="bg-np-panel border border-np-border rounded-2xl p-7 sm:p-9 glow-accent">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-np-cyan">Create account</p>
        <h1 className="text-2xl font-bold tracking-tight mt-2">Start pricing in minutes</h1>
        <p className="text-sm text-np-muted mt-1.5">
          Already have an account?{" "}
          <button
            type="button"
            onClick={() => onNavigate("login")}
            className="text-np-accent hover:underline font-medium"
          >
            Sign in
          </button>
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
          {banner && <ErrorBanner message={banner.msg} />}
          <AuthField
            label="Full name"
            value={form.name}
            onChange={set("name")}
            placeholder="Ada Lovelace"
            icon={User}
            error={errors.name}
            autoComplete="name"
          />
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

          <div>
            <AuthField
              label="Password"
              type="password"
              value={form.password}
              onChange={set("password")}
              placeholder="Min. 8 characters"
              icon={Lock}
              error={errors.password}
              autoComplete="new-password"
            />
            {form.password && (
              <div className="mt-2 flex items-center gap-2 animate-fade-in">
                <div className="flex-1 flex gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                        i < st.score ? st.color : "bg-np-border"
                      }`}
                    />
                  ))}
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-np-muted w-16 text-right">
                  {st.label}
                </span>
              </div>
            )}
          </div>

          <AuthField
            label="Confirm password"
            type="password"
            value={form.confirm}
            onChange={set("confirm")}
            placeholder="Repeat it"
            icon={Lock}
            error={errors.confirm}
            autoComplete="new-password"
          />

          <div>
            <CheckRow checked={agree} onChange={(v) => { setAgree(v); setErrors((er) => ({ ...er, agree: undefined })); }}>
              I agree to the <span className="text-np-accent">Terms of Service</span> and{" "}
              <span className="text-np-accent">Privacy Policy</span>
            </CheckRow>
            {errors.agree && (
              <span className="block text-xs font-mono text-np-red mt-1 animate-fade-in">{errors.agree}</span>
            )}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-np-accent text-np-bg font-semibold text-sm
                       py-2.5 rounded-lg hover:brightness-110 active:scale-[0.98] transition-all duration-150
                       disabled:opacity-60 disabled:pointer-events-none shadow-[0_0_18px_rgba(88,166,255,0.35)]"
          >
            {busy ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Creating account…
              </>
            ) : (
              <>
                Create account <ArrowRight size={15} />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 flex items-start gap-2 text-[11px] leading-relaxed text-np-muted/70 font-mono">
          <ShieldCheck size={14} className="text-np-green mt-px shrink-0" />
          Accounts are stored securely in MongoDB with salted password hashes. Pricing requests go straight to the
          live Flask backend.
        </p>
      </div>
    </AuthLayout>
  );
}
