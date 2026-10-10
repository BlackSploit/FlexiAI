import { z } from "zod";
import { toast } from "sonner";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { MAX_REPS } from "@/constants";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CommandSelect } from "@/components/command-select";
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

import { PrescriptionGetOne } from "../../types";
import { prescriptionsInsertSchema } from "../../schemas";

import { NewPatientDialog } from "@/modules/patients/ui/components/new-patient-dialog";

interface PrescriptionFormProps {
  onSuccess?: (id?: string) => void;
  onCancel?: () => void;
  initialValues?: PrescriptionGetOne;
  defaultPatientId?: string;
};

type In = z.input<typeof prescriptionsInsertSchema>;
type Out = z.output<typeof prescriptionsInsertSchema>;

export const PrescriptionForm = ({
  onSuccess,
  onCancel,
  initialValues,
  defaultPatientId,
}: PrescriptionFormProps) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [openNewPatientDialog, setOpenNewPatientDialog] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");

  const patients = useQuery(trpc.patients.getMany.queryOptions({ pageSize: 100, search: patientSearch }));
  const exercises = useQuery(trpc.exercises.getMany.queryOptions());

  const invalidate = async () => {
    await queryClient.invalidateQueries(trpc.prescriptions.getMany.queryOptions({}));
    await queryClient.invalidateQueries(trpc.patients.getMany.queryOptions({}));
  };

  const createPrescription = useMutation(
    trpc.prescriptions.create.mutationOptions({
      onSuccess: async (data) => {
        await invalidate();
        onSuccess?.(data.id);
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const updatePrescription = useMutation(
    trpc.prescriptions.update.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        if (initialValues?.id) {
          await queryClient.invalidateQueries(trpc.prescriptions.getOne.queryOptions({ id: initialValues.id }));
        }
        onSuccess?.();
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(prescriptionsInsertSchema),
    defaultValues: {
      patientId: initialValues?.patientId ?? defaultPatientId ?? "",
      exerciseId: initialValues?.exerciseId as Out["exerciseId"] | undefined,
      side: initialValues?.side ?? "auto",
      targetAngle: initialValues?.targetAngle ?? 60,
      reps: initialValues?.reps ?? 10,
      sets: initialValues?.sets ?? 1,
      minSecondsPerRep: initialValues?.minSecondsPerRep ?? 2,
      sessionsPerWeek: initialValues?.sessionsPerWeek ?? 5,
      active: initialValues?.active ?? true,
    },
  });

  const isEdit = !!initialValues?.id;
  const isPending = createPrescription.isPending || updatePrescription.isPending;
  const selectedExercise = (exercises.data ?? []).find((e) => e.id === form.watch("exerciseId"));

  const onSubmit = (values: Out) => {
    if (isEdit) {
      updatePrescription.mutate({ ...values, id: initialValues.id });
    } else {
      createPrescription.mutate(values);
    }
  };

  const numberField = (name: "targetAngle" | "reps" | "sets" | "minSecondsPerRep" | "sessionsPerWeek", label: string,
    props: { min: number; max: number; step?: number }, description?: string) => (
    <FormField
      name={name}
      control={form.control}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type="number" inputMode="decimal" {...props} name={field.name} ref={field.ref} onBlur={field.onBlur}
              value={field.value === undefined ? "" : String(field.value)}
              onChange={(e) => field.onChange(e.target.value)} />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <>
      <NewPatientDialog open={openNewPatientDialog} onOpenChange={setOpenNewPatientDialog}
        onCreated={(id) => id && form.setValue("patientId", id, { shouldValidate: true })} />
      <Form {...form}>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            name="patientId"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Patient</FormLabel>
                <FormControl>
                  <CommandSelect
                    options={(patients.data?.items ?? []).map((p) => ({
                      id: p.id,
                      value: p.id,
                      children: (
                        <div className="flex items-center gap-x-2">
                          <GeneratedAvatar seed={p.name} variant="initials" className="border size-6" />
                          <span>{p.name}</span>
                        </div>
                      ),
                    }))}
                    onSelect={field.onChange}
                    onSearch={setPatientSearch}
                    value={field.value}
                    placeholder="Select a patient"
                  />
                </FormControl>
                <FormDescription>
                  Not found what you&apos;re looking for?{" "}
                  <button type="button" className="text-primary hover:underline" onClick={() => setOpenNewPatientDialog(true)}>
                    Create new patient
                  </button>
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            name="exerciseId"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Exercise</FormLabel>
                <FormControl>
                  <CommandSelect
                    options={(exercises.data ?? []).map((ex) => ({
                      id: ex.id,
                      value: ex.id,
                      children: (
                        <div className="flex flex-col">
                          <span>{ex.nameEn}</span>
                          <span lang="ml" className="font-ml text-xs text-muted-foreground">{ex.nameMl}</span>
                        </div>
                      ),
                    }))}
                    onSelect={(value) => {
                      field.onChange(value);
                      const ex = exercises.data?.find((e) => e.id === value);
                      if (ex) form.setValue("targetAngle", ex.defaultTarget, { shouldValidate: true });
                    }}
                    value={field.value ?? ""}
                    placeholder="Select an exercise"
                  />
                </FormControl>
                {selectedExercise && <FormDescription>{selectedExercise.howToEn}</FormDescription>}
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-4">
            {numberField("targetAngle", "Target angle (°)", { min: 10, max: 180 },
              selectedExercise ? `At least ${selectedExercise.minPeak}°` : undefined)}
            <FormField
              name="side"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Side</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="auto">Auto (best visible)</SelectItem>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {numberField("reps", "Reps per set", { min: 1, max: MAX_REPS })}
            {numberField("sets", "Sets", { min: 1, max: 5 })}
            {numberField("minSecondsPerRep", "Min seconds per rep", { min: 0.5, max: 10, step: 0.5 })}
            {numberField("sessionsPerWeek", "Sessions per week", { min: 1, max: 14 })}
          </div>
          <FormField
            name="active"
            control={form.control}
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <FormLabel>Active</FormLabel>
                  <FormDescription>Only active prescriptions can start sessions.</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
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
    </>
  );
};
