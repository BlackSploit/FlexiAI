import { z } from "zod";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";

import { Loader2Icon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GeneratedAvatar } from "@/components/generated-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { PatientGetOne } from "../../types";
import { isPlaceholderEmail, patientsInsertSchema } from "../../schemas";

interface PatientFormProps {
  onSuccess?: (id?: string) => void;
  onCancel?: () => void;
  initialValues?: PatientGetOne;
};

type Values = z.infer<typeof patientsInsertSchema>;

export const PatientForm = ({
  onSuccess,
  onCancel,
  initialValues,
}: PatientFormProps) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const createPatient = useMutation(
    trpc.patients.create.mutationOptions({
      onSuccess: async (data) => {
        await queryClient.invalidateQueries(trpc.patients.getMany.queryOptions({}));
        onSuccess?.(data.id);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const updatePatient = useMutation(
    trpc.patients.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.patients.getMany.queryOptions({}));
        if (initialValues?.id) {
          await queryClient.invalidateQueries(trpc.patients.getOne.queryOptions({ id: initialValues.id }));
        }
        onSuccess?.();
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const form = useForm<Values>({
    resolver: zodResolver(patientsInsertSchema),
    defaultValues: {
      name: initialValues?.name ?? "",
      phone: initialValues?.phone ?? "",
      email: initialValues?.email && !isPlaceholderEmail(initialValues.email) ? initialValues.email : "",
      preferredLanguage: (initialValues?.preferredLanguage as "ml" | "en" | undefined) ?? "ml",
    },
  });

  const isEdit = !!initialValues?.id;
  const isPending = createPatient.isPending || updatePatient.isPending;

  const onSubmit = (values: Values) => {
    if (isEdit) {
      updatePatient.mutate({ ...values, id: initialValues.id });
    } else {
      createPatient.mutate(values);
    }
  };

  return (
    <Form {...form}>
      <form className="space-y-5" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
          <GeneratedAvatar
            seed={form.watch("name") || "?"}
            variant="initials"
            className="border size-12"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{form.watch("name") || "New patient"}</p>
            <p className="text-xs text-muted-foreground">Patients join by a one-time link. They never need an account.</p>
          </div>
        </div>
        <FormField
          name="name"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input {...field} autoComplete="off" placeholder="e.g. Lakshmi Nair" className="h-10" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <fieldset className="space-y-4">
          <legend className="mb-2 text-sm font-semibold">Contact</legend>
        <FormField
          name="phone"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl>
                <Input {...field} type="tel" inputMode="tel" autoComplete="off" placeholder="+919876543210" className="h-10" />
              </FormControl>
              <FormDescription>Include the country code so you can share the session link on WhatsApp or SMS.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="email"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
              <FormControl>
                <Input {...field} type="email" autoComplete="off" placeholder="name@example.com" className="h-10" />
              </FormControl>
              <FormDescription>A phone number or an email is required to send the session link.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        </fieldset>
        <FormField
          name="preferredLanguage"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Preferred language</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full h-10">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="ml"><span lang="ml" className="font-ml">മലയാളം</span> (Malayalam)</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>The coach always speaks Malayalam; English patients also see English captions.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          {onCancel && (
            <Button variant="ghost" disabled={isPending} type="button" onClick={() => onCancel()}>
              Cancel
            </Button>
          )}
          <Button disabled={isPending} type="submit">
            {isPending && <Loader2Icon className="animate-spin" />}
            {isPending ? (isEdit ? "Saving…" : "Adding…") : isEdit ? "Save changes" : "Add patient"}
          </Button>
        </div>
      </form>
    </Form>
  );
};
