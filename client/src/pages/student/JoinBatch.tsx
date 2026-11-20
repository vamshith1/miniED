import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { User } from "../../lib/types";
import { Button, Card, ErrorBox, Input } from "../../components/ui";

/** For a student who signed up themselves: join a batch with the code the institute gave them. */
export function JoinBatchCard() {
  const { replaceSession } = useAuth();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const join = useMutation({
    mutationFn: async () => {
      await api.post("/batches/join", { code });
      return api.get<{ user: User }>("/auth/me"); // now with the batch
    },
    onSuccess: (r) => {
      qc.invalidateQueries();
      replaceSession(r);
    },
  });
  return (
    <Card
      className="mt-4"
      title={
        <span className="flex items-center gap-2">
          <KeyRound className="size-4 text-brand-strong" /> Have a join code?
        </span>
      }
    >
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          join.mutate();
        }}
      >
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-1234"
          aria-label="Join code"
          maxLength={20}
          className="w-44 font-mono uppercase tracking-widest"
          autoComplete="off"
        />
        <Button type="submit" loading={join.isPending} disabled={code.replace(/[^A-Za-z0-9]/g, "").length < 4}>
          Join batch
        </Button>
      </form>
      <p className="mt-2 text-xs text-muted">Your institute or mentor gives you this code.</p>
      <div className="mt-2">
        <ErrorBox error={join.error} />
      </div>
    </Card>
  );
}
