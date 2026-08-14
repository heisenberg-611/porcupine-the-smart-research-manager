"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

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
  const next = params.get("next") ?? "/projects";

  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });

    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStage("code");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    setPending(false);
    if (error) {
      setError(error.message);
      return;
    }

    // Enrollment decides whether this user still needs identity keys, so
    // every sign-in passes through it rather than guessing here.
    router.push(`/enroll?next=${encodeURIComponent(next)}`);
    router.refresh();
  }

  if (stage === "email") {
    return (
      <form onSubmit={requestCode} className="flex flex-col gap-4">
        {error && <Banner tone="danger">{error}</Banner>}
        <Field
          label="Email"
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
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Email me a code"}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verifyCode} className="flex flex-col gap-4">
      {error && <Banner tone="danger">{error}</Banner>}
      <Banner>
        Code sent to <strong>{email}</strong>.
      </Banner>
      <Field label="Six-digit code" id="code">
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="font-mono tracking-[0.4em]"
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Verifying…" : "Sign in"}
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
  );
}
