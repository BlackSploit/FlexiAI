import { z } from "zod";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";

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
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <GeneratedAvatar
          seed={form.watch("name") || "?"}
          variant="initials"
          className="border size-16"
        />
        <FormField
          name="name"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="e.g. Lakshmi Nair" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="phone"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl>
                <Input {...field} type="tel" inputMode="tel" placeholder="+919876543210" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="email"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input {...field} type="email" placeholder="optional" />
              </FormControl>
              <FormDescription>A phone number or an email is required, to send the session link.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="preferredLanguage"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Language</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
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
        <div className="flex justify-between gap-x-2">
          {onCancel && (
            <Button variant="ghost" disabled={isPending} type="button" onClick={() => onCancel()}>
              Cancel
            </Button>
          )}
          <Button disabled={isPending} type="submit">
            {isEdit ? "Update" : "Create"}
          </Button>
        </div>
      </form>
    </Form>
  );
};
