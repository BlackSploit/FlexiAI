import { z } from "zod";
import { toast } from "sonner";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Loader2Icon } from "lucide-react";

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
            <Input type="number" inputMode="decimal" className="h-10 tabular-nums" {...props} name={field.name} ref={field.ref} onBlur={field.onBlur}
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
        <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <fieldset className="space-y-4">
            <legend className="mb-3 text-sm font-semibold">Patient &amp; exercise</legend>
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
                    className="h-10"
                  />
                </FormControl>
                <FormDescription>
                  New patient?{" "}
                  <button type="button" className="font-medium text-primary hover:underline" onClick={() => setOpenNewPatientDialog(true)}>
                    Add them first
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
                    className="h-10"
                  />
                </FormControl>
                <FormDescription>
                  {selectedExercise ? selectedExercise.howToEn : "The coach explains the movement in Malayalam and counts each rep."}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          </fieldset>
          <fieldset className="space-y-4">
            <legend className="mb-3 text-sm font-semibold">Movement target</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {numberField("targetAngle", "Target angle (°)", { min: 10, max: 180 },
              selectedExercise
                ? `Target bend angle in degrees. At least ${selectedExercise.minPeak}° for this exercise.`
                : "Target bend angle in degrees.")}
            <FormField
              name="side"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Side</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full h-10"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="auto">Auto (best visible)</SelectItem>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>Which limb the camera tracks.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          </fieldset>
          <fieldset className="space-y-4">
            <legend className="mb-3 text-sm font-semibold">Volume &amp; schedule</legend>
          <div className="grid grid-cols-2 gap-4">
            {numberField("reps", "Reps per set", { min: 1, max: MAX_REPS }, `1 to ${MAX_REPS}`)}
            {numberField("sets", "Sets", { min: 1, max: 5 }, "1 to 5, with a rest between")}
            {numberField("minSecondsPerRep", "Min seconds per rep", { min: 0.5, max: 10, step: 0.5 }, "Faster reps get a “slow down” cue")}
            {numberField("sessionsPerWeek", "Sessions per week", { min: 1, max: 14 }, "Used for adherence")}
          </div>
          </fieldset>
          <FormField
            name="active"
            control={form.control}
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 p-4">
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
          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            {onCancel && (
              <Button variant="ghost" disabled={isPending} type="button" onClick={() => onCancel()}>
                Cancel
              </Button>
            )}
            <Button disabled={isPending} type="submit">
              {isPending && <Loader2Icon className="animate-spin" />}
              {isPending ? "Saving…" : isEdit ? "Save changes" : "Create prescription"}
            </Button>
          </div>
        </form>
      </Form>
    </>
  );
};
