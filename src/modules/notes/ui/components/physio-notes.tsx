"use client";

import { toast } from "sonner";
import { useState } from "react";
import { format } from "date-fns";
import { TrashIcon } from "lucide-react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** The physio's private notes about a patient. */
export const PhysioNotes = ({ patientId }: { patientId: string }) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
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

  return (
    <div className="flex flex-col gap-y-3">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note for yourself" maxLength={4000} />
      <Button className="self-end" size="sm" disabled={!text.trim() || create.isPending}
        onClick={() => create.mutate({ patientId, text })}>
        Add note
      </Button>
      <ul className="flex flex-col gap-y-2">
        {data.map((n) => (
          <li key={n.id} className="rounded-md border p-3 text-sm">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{format(new Date(n.createdAt), "MMM d, yyyy HH:mm")}</span>
              <button aria-label="Delete note" onClick={() => remove.mutate({ id: n.id })}><TrashIcon className="size-3.5" /></button>
            </div>
            <p className="whitespace-pre-wrap">{n.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
};
