"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useState } from "react";

import { Banner, Button, Field, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/**
 * Email OTP sign-in.
 *
 * A six-digit code rather than a magic link: links break in webmail
 * previewers and in-app browsers, and a code can be typed on the device that
 * requested it. It is also the only variant that can be tested end-to-end
 * without driving an email client.
 */
export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/dashboard";

  const [stage, setStage] = useState<"email" | "code">("email");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Named: the Google button and the email form are on screen together and
  // share this flag. Without the name, starting the Google redirect makes
  // "Email me a login code" announce "Sending…" while nothing is being sent.
  const [running, setRunning] = useState<null | "google" | "code" | "verify">(null);
  const pending = running !== null;

  async function requestCode(e: React.FormEvent) {
    setRunning("code");
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim().toLowerCase();

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: { shouldCreateUser: true },
    });

    setRunning(null);
    if (error) {
      setError(error.message);
      return;
    }
    setStage("code");
  }

  async function verifyCode(e: React.FormEvent) {
    setRunning("verify");
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    const cleanCode = code.replace(/[^0-9]/g, "");

    const supabase = createClient();
    let { error } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanCode,
      type: "email",
    });

    // Fallbacks if Supabase generated a specific token type rather than generic email
    if (error && error.message.includes("expired or is invalid")) {
      const retry = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanCode,
        type: "magiclink",
      });
      error = retry.error;

      if (error && error.message.includes("expired or is invalid")) {
        const signupRetry = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: cleanCode,
          type: "signup",
        });
        error = signupRetry.error;
      }
    }

    if (error) {
      setRunning(null);
      setError(error.message);
      return;
    }

    // Enrollment decides whether this user still needs identity keys, so
    // every sign-in passes through it rather than guessing here.
    startTransition(() => {
      router.push(`/enroll?next=${encodeURIComponent(next)}`);
      router.refresh();
    });
  }

  async function signInWithGoogle() {
    setRunning("google");
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setError(error.message);
      setRunning(null);
    }
  }

  if (stage === "email") {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-ink text-title font-semibold tracking-tight">
            {mode === "signin" ? "Sign in to your account" : "Create an account"}
          </h1>
        </div>
        <form onSubmit={requestCode} className="flex flex-col gap-4">
          {error && <Banner tone="danger">{error}</Banner>}

          <Button
            type="button"
            variant="ghost"
            onClick={signInWithGoogle}
            disabled={pending}
            busy={running === "google"}
            busyLabel="Taking you to Google…"
            className="bg-surface border-border hover:bg-surface-hover mb-2 flex min-h-12 w-full items-center justify-center gap-3 border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span className="font-medium">Continue with Google</span>
          </Button>
          <p className="text-muted text-ui text-pretty">
            Use your university address if you have one.
          </p>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="border-border w-full border-t"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-canvas text-muted text-fine px-4 font-medium uppercase">
                or
              </span>
            </div>
          </div>

          <p className="text-muted text-ui mb-1 text-pretty">
            {mode === "signin"
              ? "Welcome back. We'll email you a six-digit code. No password to forget."
              : "Start managing your research. We'll email you a six-digit code to confirm the address."}
          </p>

          <Field
            label="Email Address"
            id="email"
            hint="Use your institutional address if you have one."
          >
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@university.edu"
            />
          </Field>
          <Button type="submit" busy={running === "code"} busyLabel="Sending…">
            {mode === "signin" ? "Email me a login code" : "Email me a signup code"}
          </Button>

          <div className="text-ui text-muted mt-4 text-center">
            {mode === "signin" ? (
              <p>
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className="text-accent font-medium hover:underline focus-visible:outline-none"
                >
                  Sign up
                </button>
              </p>
            ) : (
              <p>
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className="text-accent font-medium hover:underline focus-visible:outline-none"
                >
                  Log in
                </button>
              </p>
            )}
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-ink text-title font-semibold tracking-tight">
          {mode === "signin" ? "Sign in to your account" : "Create an account"}
        </h1>
        <p className="text-muted text-ui mt-2 text-pretty">
          Check your email for the code.
        </p>
      </div>
      <form onSubmit={verifyCode} className="flex flex-col gap-4">
        {error && <Banner tone="danger">{error}</Banner>}
        <Banner>
          Code sent to <strong>{email}</strong>.
        </Banner>
        <Field label="Verification code" id="code">
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            /*
             * Six. Not "6 to 8".
             *
             * `otp_length = 6` in supabase/config.toml is what actually
             * generates the code, so the copy above promising eight digits
             * described a code that has never been sent, and a field that
             * accepted eight let someone paste a wrong-length value and get a
             * server-side rejection instead of the browser catching it.
             */
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="font-mono tracking-[0.4em]"
          />
        </Field>
        <Button type="submit" busy={running === "verify"} busyLabel="Verifying…">
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setStage("email");
            setCode("");
            setError(null);
          }}
        >
          Use a different email
        </Button>
      </form>
    </div>
  );
}
