import { useRouter } from "next/navigation";

import { ResponsiveDialog } from "@/components/responsive-dialog";

import { PrescriptionForm } from "./prescription-form";

interface NewPrescriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPatientId?: string;
};

export const NewPrescriptionDialog = ({
  open,
  onOpenChange,
  defaultPatientId,
}: NewPrescriptionDialogProps) => {
  const router = useRouter();

  return (
    <ResponsiveDialog
      title="New prescription"
      description="Set the exercise, target angle and volume. The coach guides the patient through it."
      open={open}
      onOpenChange={onOpenChange}
    >
      <PrescriptionForm
        defaultPatientId={defaultPatientId}
        onSuccess={(id) => {
          onOpenChange(false);
          router.push(`/prescriptions/${id}`);
        }}
        onCancel={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  );
};
