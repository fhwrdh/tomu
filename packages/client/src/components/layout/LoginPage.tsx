import { useState } from "react";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { useAuth } from "../../hooks/useAuth.js";

export function LoginPage() {
  const { login, register, loginError, registerError } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isRegistering) {
        await register({ email, password, displayName: displayName || undefined });
      } else {
        await login({ email, password });
      }
    } catch {
      // Error handled by mutation state
    } finally {
      setLoading(false);
    }
  };

  const error = isRegistering ? registerError : loginError;

  return (
    <div className="dark flex min-h-dvh items-center justify-center bg-background text-foreground">
      <div className="w-full max-w-sm px-6">
        <h1 className="mb-8 text-center text-3xl font-bold tracking-tight">Tomu</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegistering && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">Name</label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-sm font-medium">Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Password</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
          </div>
          {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "..." : isRegistering ? "Create Account" : "Log In"}
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setIsRegistering(!isRegistering)}
          >
            {isRegistering ? "Already have an account? Log in" : "Need an account? Register"}
          </button>
        </form>
      </div>
    </div>
  );
}
