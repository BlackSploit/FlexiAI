"use client";

import { toast } from "sonner";
import { useId, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { Loader2Icon, NotebookPenIcon, TrashIcon } from "lucide-react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/trpc/client";

const MAX_LEN = 4000;

/** The physio's private notes about a patient. */
export const PhysioNotes = ({ patientId }: { patientId: string }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const inputId = useId();
  const [text, setText] = useState("");
  const { data } = useSuspenseQuery(trpc.notes.getMany.queryOptions({ patientId }));
  const refresh = () => queryClient.invalidateQueries(trpc.notes.getMany.queryOptions({ patientId }));

  const create = useMutation(trpc.notes.create.mutationOptions({
    onSuccess: async () => {
      setText("");
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  }));
  const remove = useMutation(trpc.notes.remove.mutationOptions({ onSuccess: refresh, onError: (e) => toast.error(e.message) }));

  const submit = () => {
    if (!text.trim() || create.isPending) return;
    create.mutate({ patientId, text });
  };

  return (
    <div className="flex flex-col gap-y-4">
      <form
        className="flex flex-col gap-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor={inputId} className="sr-only">New note</label>
        <Textarea
          id={inputId}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="e.g. Knee swelling reduced. Increase target to 90° next week."
          maxLength={MAX_LEN}
          className="min-h-20 resize-y bg-background"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {text.length > MAX_LEN * 0.8 ? `${text.length}/${MAX_LEN}` : "Ctrl + Enter to save"}
          </span>
          <Button type="submit" size="sm" disabled={!text.trim() || create.isPending}>
            {create.isPending && <Loader2Icon className="animate-spin" />}
            {create.isPending ? "Saving…" : "Add note"}
          </Button>
        </div>
      </form>

      {data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <NotebookPenIcon className="size-4" aria-hidden />
          </span>
          <p className="text-sm font-medium">No notes yet</p>
          <p className="text-xs text-muted-foreground">Keep track of observations, plan changes and follow-ups.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-y-2">
          {data.map((n) => {
            const at = new Date(n.createdAt);
            const deleting = remove.isPending && remove.variables?.id === n.id;
            return (
              <li key={n.id} className="group rounded-lg border bg-background p-3 text-sm">
                <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <time dateTime={at.toISOString()} title={format(at, "PPpp")}>
                    {formatDistanceToNow(at, { addSuffix: true })}
                  </time>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    aria-label="Delete note"
                    disabled={deleting}
                    onClick={() => remove.mutate({ id: n.id })}
                  >
                    {deleting ? <Loader2Icon className="size-3.5 animate-spin" /> : <TrashIcon className="size-3.5" />}
                  </Button>
                </div>
                <p className="whitespace-pre-wrap leading-relaxed">{n.text}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
